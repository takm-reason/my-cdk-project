import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SmallScaleStack } from '../lib/small-scale-stack';

describe('SmallScaleStack', () => {
    const app = new cdk.App();
    const stack = new SmallScaleStack(app, 'TestSmallScaleStack', {
        projectName: 'test20250228',
        environment: 'development',
    });
    const template = Template.fromStack(stack);

    // VPCのテスト
    test('VPC should be created with correct configuration', () => {
        template.hasResourceProperties('AWS::EC2::VPC', {
            EnableDnsHostnames: true,
            EnableDnsSupport: true,
            CidrBlock: '10.0.0.0/16',
        });

        // サブネットとNAT Gatewayの数を確認
        template.resourceCountIs('AWS::EC2::Subnet', 4); // 2 AZs × (Public + Private)
        template.resourceCountIs('AWS::EC2::NatGateway', 1);
    });

    // RDSのテスト
    test('RDS instance should be created with correct configuration', () => {
        template.hasResourceProperties('AWS::RDS::DBInstance', {
            Engine: 'postgres',
            EngineVersion: '15',
            DBInstanceClass: 'db.t4g.small',
            MultiAZ: false,
            AllocatedStorage: Match.stringLikeRegexp('20'),
            MaxAllocatedStorage: 100,
            BackupRetentionPeriod: 7,
            DeleteAutomatedBackups: true,
        });
    });

    // S3バケットのテスト
    test('S3 bucket should be created with correct configuration', () => {
        template.hasResourceProperties('AWS::S3::Bucket', {
            VersioningConfiguration: {
                Status: 'Enabled',
            },
            BucketEncryption: {
                ServerSideEncryptionConfiguration: [
                    {
                        ServerSideEncryptionByDefault: {
                            SSEAlgorithm: 'AES256',
                        },
                    },
                ],
            },
            LifecycleConfiguration: {
                Rules: [
                    Match.objectLike({
                        ExpirationInDays: 365,
                        NoncurrentVersionExpiration: {
                            NoncurrentDays: 30,
                        },
                        Status: 'Enabled',
                    }),
                ],
            },
        });
    });

    // ECSクラスターとFargateサービスのテスト
    test('ECS Cluster and Fargate Service should be created with correct configuration', () => {
        // ECSクラスター
        template.hasResourceProperties('AWS::ECS::Cluster', {});

        // Fargateサービス
        template.hasResourceProperties('AWS::ECS::Service', {
            LaunchType: 'FARGATE',
            DesiredCount: 1,
            NetworkConfiguration: {
                AwsvpcConfiguration: {
                    AssignPublicIp: 'DISABLED',
                },
            },
        });

        // タスク定義
        template.hasResourceProperties('AWS::ECS::TaskDefinition', {
            Cpu: '512',
            Memory: '1024',
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: ['FARGATE'],
        });
    });

    // Auto Scalingのテスト
    test('Auto Scaling should be configured correctly', () => {
        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
            PolicyType: 'TargetTrackingScaling',
            TargetTrackingScalingPolicyConfiguration: {
                TargetValue: 75,
                ScaleInCooldown: 300,
                ScaleOutCooldown: 300,
                PredefinedMetricSpecification: {
                    PredefinedMetricType: 'ECSServiceAverageCPUUtilization',
                },
            },
        });

        template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
            MinCapacity: 1,
            MaxCapacity: 2,
        });
    });

    // セキュリティグループのテスト
    test('Security Groups should be configured correctly', () => {
        // RDSセキュリティグループの存在確認
        template.hasResourceProperties(
            'AWS::EC2::SecurityGroupIngress',
            Match.objectLike({
                FromPort: 5432,
                IpProtocol: 'tcp',
                ToPort: 5432,
            }),
        );
    });

    // 出力のテスト
    test('Stack outputs should be defined', () => {
        template.hasOutput('LoadBalancerDNS', {})
        template.hasOutput('S3BucketName', {})
    });
});
