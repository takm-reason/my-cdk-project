import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as shield from 'aws-cdk-lib/aws-shield';
import { Construct } from 'constructs';
import { LargeScaleStack } from '../lib/large-scale-stack';
import { VpcBuilder } from '../lib/utils/builders/vpc-builder';
import { DbBuilder } from '../lib/utils/builders/db-builder';
import { CacheBuilder } from '../lib/utils/builders/cache-builder';
import { EcsBuilder } from '../lib/utils/builders/ecs-builder';
import { WafBuilder } from '../lib/utils/builders/waf-builder';
import { CdnBuilder } from '../lib/utils/builders/cdn-builder';

const createMockStack = () => {
    const app = new cdk.App();
    return new cdk.Stack(app, 'MockStack');
};

// VpcBuilderのモック
jest.mock('../lib/utils/builders/vpc-builder', () => ({
    VpcBuilder: jest.fn().mockImplementation(() => ({
        build: () => new ec2.Vpc(createMockStack(), 'MockVpc', {
            maxAzs: 3,
            natGateways: 3,
        }),
    })),
}));

// DbBuilderのモック（Global Database設定）
jest.mock('../lib/utils/builders/db-builder', () => ({
    DbBuilder: jest.fn().mockImplementation(() => ({
        build: () => {
            const cluster = new rds.DatabaseCluster(createMockStack(), 'MockAurora', {
                engine: rds.DatabaseClusterEngine.auroraPostgres({
                    version: rds.AuroraPostgresEngineVersion.VER_15_2,
                }),
                instanceProps: {
                    instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
                    vpc: new ec2.Vpc(createMockStack(), 'MockVpc'),
                },
                instances: 3,
            });
            return cluster;
        },
    })),
}));

// CacheBuilderのモック（マルチAZレプリケーショングループ）
jest.mock('../lib/utils/builders/cache-builder', () => ({
    CacheBuilder: jest.fn().mockImplementation(() => ({
        build: () => new elasticache.CfnReplicationGroup(createMockStack(), 'MockRedis', {
            replicationGroupDescription: 'Mock Redis Replication Group',
            engine: 'redis',
            cacheNodeType: 'cache.r6g.large',
            numNodeGroups: 3,
            replicasPerNodeGroup: 2,
            automaticFailoverEnabled: true,
            multiAzEnabled: true,
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

// WafBuilderのモック（CloudFront WAF）
jest.mock('../lib/utils/builders/waf-builder', () => ({
    WafBuilder: jest.fn().mockImplementation(() => ({
        build: () => new wafv2.CfnWebACL(createMockStack(), 'MockWaf', {
            defaultAction: { allow: {} },
            scope: 'CLOUDFRONT',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'MockWafMetric',
                sampledRequestsEnabled: true,
            },
        }),
    })),
}));

describe('LargeScaleStack', () => {
    let app: cdk.App;
    let stack: LargeScaleStack;
    let template: Template;

    beforeEach(() => {
        app = new cdk.App();
        stack = new LargeScaleStack(app, 'TestStack', {
            projectName: 'test-project',
            environment: 'production',
        });
        template = Template.fromStack(stack);
    });

    test('VPCが高可用性構成で作成される', () => {
        template.hasResourceProperties('AWS::EC2::VPC', {
            Tags: Match.arrayWith([
                {
                    Key: 'Environment',
                    Value: 'production',
                },
            ]),
        });

        expect(VpcBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                maxAzs: 3,
                natGateways: 3,
            })
        );
    });

    test('Auroraグローバルデータベースが正しく設定される', () => {
        template.hasResourceProperties('AWS::RDS::DBCluster', {
            Engine: 'aurora-postgresql',
            EngineVersion: Match.stringLikeRegexp('15.2'),
            DBClusterInstanceClass: 'db.r6g.large',
            ReplicationSourceIdentifier: Match.absent(),
        });

        template.hasResourceProperties('AWS::RDS::GlobalCluster', {
            Engine: 'aurora-postgresql',
            SourceDBClusterIdentifier: Match.anyValue(),
        });
    });

    test('Auroraの高可用性設定が正しい', () => {
        expect(DbBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                instances: 3,
                multiAz: true,
            })
        );
    });

    test('Redisクラスターがマルチシャード構成で作成される', () => {
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            Engine: 'redis',
            CacheNodeType: 'cache.r6g.large',
            NumNodeGroups: 3,
            ReplicasPerNodeGroup: 2,
            AutomaticFailoverEnabled: true,
            MultiAZEnabled: true,
        });
    });

    test('CloudFront WAFが正しく設定される', () => {
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Scope: 'CLOUDFRONT',
            DefaultAction: {
                Allow: {},
            },
            Rules: Match.arrayWith([
                Match.objectLike({
                    Name: 'RateLimit',
                    Priority: 2,
                    Statement: {
                        RateBasedStatement: {
                            Limit: 2000,
                            AggregateKeyType: 'IP',
                        },
                    },
                }),
            ]),
        });
    });

    test('Shield Advancedが有効化される', () => {
        template.hasResourceProperties('AWS::Shield::Protection', {
            Name: 'LargeScaleProtection',
            ResourceArn: Match.anyValue(),
        });
    });

    test('ECSサービスが大規模スケーリング用に設定される', () => {
        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
            MinCapacity: 10,
            MaxCapacity: 50,
        });

        template.hasResourceProperties('AWS::ECS::Service', {
            DesiredCount: 10,
            LaunchType: 'FARGATE',
        });
    });

    test('ECSタスクが高スペック設定で作成される', () => {
        template.hasResourceProperties('AWS::ECS::TaskDefinition', {
            Cpu: '2048',
            Memory: '4096',
        });
    });

    test('CloudWatchアラームが詳細に設定される', () => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Period: 60,
            EvaluationPeriods: 3,
            DatapointsToAlarm: Match.anyValue(),
        });
    });

    test('バックアップ保持期間が長期に設定される', () => {
        template.hasResourceProperties('AWS::RDS::DBCluster', {
            BackupRetentionPeriod: 30,
        });
    });

    test('CloudFrontディストリビューションがWAFと関連付けられる', () => {
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: Match.objectLike({
                WebACLId: Match.anyValue(),
            }),
        });
    });
});