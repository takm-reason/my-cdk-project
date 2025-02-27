import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { MediumScaleStack } from '../lib/medium-scale-stack';
import { VpcBuilder } from '../lib/utils/builders/vpc-builder';
import { DbBuilder } from '../lib/utils/builders/db-builder';
import { CacheBuilder } from '../lib/utils/builders/cache-builder';
import { EcsBuilder } from '../lib/utils/builders/ecs-builder';
import { WafBuilder } from '../lib/utils/builders/waf-builder';

// モック用のスタック作成関数
const createMockStack = () => {
    const app = new cdk.App();
    return new cdk.Stack(app, 'MockStack');
};

// VpcBuilderのモック
jest.mock('../lib/utils/builders/vpc-builder', () => ({
    VpcBuilder: jest.fn().mockImplementation(() => ({
        build: () => new ec2.Vpc(createMockStack(), 'MockVpc', {
            maxAzs: 3,
            natGateways: 2,
        }),
    })),
}));

// DbBuilderのモック
jest.mock('../lib/utils/builders/db-builder', () => ({
    DbBuilder: jest.fn().mockImplementation(() => ({
        build: () => new rds.DatabaseCluster(createMockStack(), 'MockAurora', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_15_2,
            }),
            instanceProps: {
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
                vpc: new ec2.Vpc(createMockStack(), 'MockVpc'),
            },
            instances: 2,
        }),
    })),
}));

// CacheBuilderのモック
jest.mock('../lib/utils/builders/cache-builder', () => ({
    CacheBuilder: jest.fn().mockImplementation(() => ({
        build: () => new elasticache.CfnCacheCluster(createMockStack(), 'MockRedis', {
            engine: 'redis',
            cacheNodeType: 'cache.t4g.medium',
            numCacheNodes: 1,
        }),
    })),
}));

// EcsBuilderのモック
jest.mock('../lib/utils/builders/ecs-builder', () => ({
    EcsBuilder: jest.fn().mockImplementation(() => ({
        build: () => ({
            cluster: new cdk.aws_ecs.Cluster(createMockStack(), 'MockCluster', {
                vpc: new ec2.Vpc(createMockStack(), 'MockVpc'),
            }),
        }),
    })),
}));

// WafBuilderのモック
jest.mock('../lib/utils/builders/waf-builder', () => ({
    WafBuilder: jest.fn().mockImplementation(() => ({
        build: () => new wafv2.CfnWebACL(createMockStack(), 'MockWaf', {
            defaultAction: { allow: {} },
            scope: 'REGIONAL',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'MockWafMetric',
                sampledRequestsEnabled: true,
            },
        }),
    })),
}));

describe('MediumScaleStack', () => {
    let app: cdk.App;
    let stack: MediumScaleStack;
    let template: Template;

    beforeEach(() => {
        app = new cdk.App();
        stack = new MediumScaleStack(app, 'TestStack', {
            projectName: 'test-project',
            environment: 'development',
        });
        template = Template.fromStack(stack);
    });

    test('VPCがマルチAZで構成される', () => {
        template.hasResourceProperties('AWS::EC2::VPC', {
            Tags: Match.arrayWith([
                {
                    Key: 'Environment',
                    Value: 'development',
                },
            ]),
        });

        expect(VpcBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                maxAzs: 3,
                natGateways: 2,
            })
        );
    });

    test('Aurora Serverless v2が正しく設定される', () => {
        template.hasResourceProperties('AWS::RDS::DBCluster', {
            Engine: 'aurora-postgresql',
            ServerlessV2ScalingConfiguration: {
                MinCapacity: 0.5,
                MaxCapacity: 2.0,
            },
            EngineVersion: Match.stringLikeRegexp('15.2'),
        });
    });

    test('Auroraのレプリカ数が正しい', () => {
        expect(DbBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                instances: 2,
            })
        );
    });

    test('Redisが適切なインスタンスタイプで設定される', () => {
        template.hasResourceProperties('AWS::ElastiCache::CacheCluster', {
            CacheNodeType: 'cache.t4g.medium',
            Engine: 'redis',
            NumCacheNodes: 1,
        });
    });

    test('WAFがリージョナルモードで設定される', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Scope: 'REGIONAL',
            DefaultAction: {
                Allow: {},
            },
        });
    });

    test('WAFがALBに関連付けられる', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACLAssociation', {
            WebACLArn: Match.anyValue(),
            ResourceArn: Match.anyValue(),
        });
    });

    test('ECSサービスの高度なスケーリング設定', () => {
        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
            MinCapacity: 2,
            MaxCapacity: 5,
        });

        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
            TargetTrackingScalingPolicyConfiguration: {
                TargetValue: 70.0,
                PredefinedMetricSpecification: {
                    PredefinedMetricType: 'ECSServiceAverageCPUUtilization',
                },
            },
        });
    });

    test('メモリベースのスケーリングポリシーが設定される', () => {
        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
            TargetTrackingScalingPolicyConfiguration: {
                TargetValue: 70.0,
                PredefinedMetricSpecification: {
                    PredefinedMetricType: 'ECSServiceAverageMemoryUtilization',
                },
            },
        });
    });

    test('クールダウン設定が正しい', () => {
        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
            TargetTrackingScalingPolicyConfiguration: {
                ScaleInCooldown: 60,
                ScaleOutCooldown: 60,
            },
        });
    });

    test('ALBのヘルスチェック設定が適切', () => {
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
            HealthCheckEnabled: true,
            HealthCheckIntervalSeconds: Match.anyValue(),
            HealthyThresholdCount: Match.anyValue(),
        });
    });
});