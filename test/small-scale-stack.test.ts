import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';
import { SmallScaleStack } from '../lib/small-scale-stack';
import { VpcBuilder } from '../lib/utils/builders/vpc-builder';
import { DbBuilder } from '../lib/utils/builders/db-builder';
import { CacheBuilder } from '../lib/utils/builders/cache-builder';
import { EcsBuilder } from '../lib/utils/builders/ecs-builder';

// モック用のスタック作成関数
const createMockStack = () => {
    const app = new cdk.App();
    return new cdk.Stack(app, 'MockStack');
};

// VpcBuilderのモック
jest.mock('../lib/utils/builders/vpc-builder', () => {
    return {
        VpcBuilder: jest.fn().mockImplementation(() => ({
            build: () => new ec2.Vpc(createMockStack(), 'MockVpc', {
                maxAzs: 2,
                natGateways: 1,
            }),
        })),
    };
});

// DbBuilderのモック
jest.mock('../lib/utils/builders/db-builder', () => {
    return {
        DbBuilder: jest.fn().mockImplementation(() => ({
            build: () => new rds.DatabaseInstance(createMockStack(), 'MockDb', {
                engine: rds.DatabaseInstanceEngine.postgres({
                    version: rds.PostgresEngineVersion.VER_15,
                }),
                vpc: new ec2.Vpc(createMockStack(), 'MockVpc'),
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
            }),
        })),
    };
});

// CacheBuilderのモック
jest.mock('../lib/utils/builders/cache-builder', () => {
    return {
        CacheBuilder: jest.fn().mockImplementation(() => ({
            build: () => new elasticache.CfnCacheCluster(createMockStack(), 'MockRedis', {
                engine: 'redis',
                cacheNodeType: 'cache.t4g.micro',
                numCacheNodes: 1,
            }),
        })),
    };
});

// EcsBuilderのモック
jest.mock('../lib/utils/builders/ecs-builder', () => {
    return {
        EcsBuilder: jest.fn().mockImplementation(() => ({
            build: () => ({
                cluster: new cdk.aws_ecs.Cluster(createMockStack(), 'MockCluster', {
                    vpc: new ec2.Vpc(createMockStack(), 'MockVpc'),
                }),
            }),
        })),
    };
});

describe('SmallScaleStack', () => {
    let app: cdk.App;
    let stack: SmallScaleStack;
    let template: Template;

    beforeEach(() => {
        app = new cdk.App();
        stack = new SmallScaleStack(app, 'TestStack', {
            projectName: 'test-project',
            environment: 'development',
        });
        template = Template.fromStack(stack);
    });

    test('スタックが正しい環境タグを持つ', () => {
        template.hasResourceProperties('AWS::EC2::VPC', {
            Tags: Match.arrayWith([
                {
                    Key: 'Environment',
                    Value: 'development',
                },
                {
                    Key: 'Project',
                    Value: 'test-project',
                },
            ]),
        });
    });

    test('VpcBuilderが正しく呼び出される', () => {
        expect(VpcBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                projectName: 'test-project',
                environment: 'development',
                maxAzs: 2,
                natGateways: 1,
            })
        );
    });

    test('DbBuilderが正しく呼び出される', () => {
        expect(DbBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                projectName: 'test-project',
                environment: 'development',
                engine: 'postgresql',
                multiAz: false,
            })
        );
    });

    test('CacheBuilderが正しく呼び出される', () => {
        expect(CacheBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                projectName: 'test-project',
                environment: 'development',
                engine: 'redis',
                nodeType: 'cache.t4g.micro',
                multiAz: false,
            })
        );
    });

    test('EcsBuilderが正しく呼び出される', () => {
        expect(EcsBuilder).toHaveBeenCalledWith(
            expect.any(Construct),
            expect.objectContaining({
                projectName: 'test-project',
                environment: 'development',
                cpu: 512,
                memoryLimitMiB: 1024,
                desiredCount: 1,
            })
        );
    });

    test('RDSインスタンスが正しく設定される', () => {
        template.hasResourceProperties('AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.t4g.small',
            Engine: 'postgres',
            MultiAZ: false,
            AllocatedStorage: Match.anyValue(),
            BackupRetentionPeriod: 7,
        });
    });

    test('RDSのストレージ設定が正しい', () => {
        template.hasResourceProperties('AWS::RDS::DBInstance', {
            AllocatedStorage: 20,
            MaxAllocatedStorage: 100,
        });
    });

    test('Redisインスタンスが正しく設定される', () => {
        template.hasResourceProperties('AWS::ElastiCache::CacheCluster', {
            CacheNodeType: 'cache.t4g.micro',
            Engine: 'redis',
            NumCacheNodes: 1,
        });
    });

    test('ECSサービスが正しく設定される', () => {
        template.hasResourceProperties('AWS::ECS::Service', {
            DesiredCount: 1,
            LaunchType: 'FARGATE',
        });
    });

    test('Auto Scaling設定が正しく構成される', () => {
        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
            MinCapacity: 1,
            MaxCapacity: 2,
        });
    });
});