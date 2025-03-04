import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { InfrastructureStack, InfraBaseStackProps } from './infra-base-stack';

export class InfraMediumStack extends InfrastructureStack {
    constructor(scope: Construct, id: string, props: InfraBaseStackProps) {
        super(scope, id, props);

        // S3バケットの作成
        const bucket = new s3.Bucket(this, 'StorageBucket', {
            bucketName: `${this.projectPrefix.toLowerCase()}-${this.envName}-${this.resourceSuffix}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.RETAIN,
            lifecycleRules: [
                {
                    expiration: cdk.Duration.days(365 * 2), // 2年
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        },
                        {
                            storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: cdk.Duration.days(60),
                        },
                        {
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(180),
                        }
                    ]
                }
            ],
            metrics: [
                {
                    id: 'EntireBucket',
                },
                {
                    id: 'FilesOnly',
                    prefix: 'files/',
                }
            ],
        });

        // Medium環境用のVPC設定
        const vpc = new ec2.Vpc(this, 'MediumVPC', {
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
                {
                    name: 'Database',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                }
            ]
        });

        // Medium環境用のAurora Serverless v2
        const database = new rds.DatabaseCluster(this, 'MediumDatabase', {
            engine: rds.DatabaseClusterEngine.auroraMysql({
                version: rds.AuroraMysqlEngineVersion.VER_3_04_0
            }),
            credentials: rds.Credentials.fromSecret(this.databaseSecret),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED
            },
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: 4.0,
            writer: rds.ClusterInstance.serverlessV2('writer', {
                autoMinorVersionUpgrade: true,
                enablePerformanceInsights: true,
                performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
            }),
            readers: [
                rds.ClusterInstance.serverlessV2('reader1', {
                    autoMinorVersionUpgrade: true,
                    enablePerformanceInsights: true,
                    performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
                    scaleWithWriter: true,
                })
            ],
            backup: {
                retention: Duration.days(14),
                preferredWindow: '03:00-04:00',
            },
            cloudwatchLogsExports: ['error', 'general', 'slowquery'],
            monitoringInterval: Duration.seconds(30),
            defaultDatabaseName: 'appdb',
        });

        // ECS Fargateクラスター
        const cluster = new ecs.Cluster(this, 'MediumCluster', {
            vpc,
            enableFargateCapacityProviders: true,
        });

        // ElastiCache (Redis)の設定
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
            description: 'Subnet group for Redis cache',
        });

        const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
            vpc,
            description: 'Security group for Redis cache',
            allowAllOutbound: true,
        });

        const redis = new elasticache.CfnReplicationGroup(this, 'MediumRedis', {
            replicationGroupDescription: 'Redis cluster for medium environment',
            engine: 'redis',
            cacheNodeType: 'cache.t3.medium',
            numCacheClusters: 2,
            securityGroupIds: [redisSecurityGroup.securityGroupId],
            cacheSubnetGroupName: redisSubnetGroup.ref,
            engineVersion: '7.0',
            preferredMaintenanceWindow: 'sun:23:00-mon:01:30',
            autoMinorVersionUpgrade: true,
            transitEncryptionEnabled: true,
            atRestEncryptionEnabled: true,
            automaticFailoverEnabled: true,
        });

        // タスク定義の作成
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'MediumTaskDef', {
            cpu: 512,
            memoryLimitMiB: 1024,
        });

        // コンテナの追加
        const container = taskDefinition.addContainer('AppContainer', {
            image: ecs.ContainerImage.fromRegistry('nginx:latest'),
            secrets: {
                DATABASE_USERNAME: ecs.Secret.fromSecretsManager(this.databaseSecret, 'username'),
                DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(this.databaseSecret, 'password'),
                REDIS_AUTH_TOKEN: ecs.Secret.fromSecretsManager(this.redisSecret, 'authToken'),
            },
            environment: {
                DATABASE_HOST: database.clusterEndpoint.hostname,
                DATABASE_PORT: database.clusterEndpoint.port.toString(),
                DATABASE_NAME: 'appdb',
                RAILS_ENV: 'production',
                REDIS_URL: redis.attrPrimaryEndPointAddress,
                REDIS_PORT: redis.attrPrimaryEndPointPort,
            },
        });

        container.addPortMappings({
            containerPort: 80,
            protocol: ecs.Protocol.TCP,
        });

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MediumService', {
            cluster,
            taskDefinition,
            desiredCount: 2,
            publicLoadBalancer: true,
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
        });

        // Auto Scaling設定
        const scaling = fargateService.service.autoScaleTaskCount({
            minCapacity: 2,
            maxCapacity: 8,
        });

        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60),
        });

        scaling.scaleOnRequestCount('RequestScaling', {
            requestsPerTarget: 1000,
            targetGroup: fargateService.targetGroup,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60),
        });

        // RDSへのアクセスを許可
        database.connections.allowFrom(
            fargateService.service,
            ec2.Port.tcp(3306),
            'Allow from Fargate service'
        );

        // RedisへのアクセスをFargateサービスに許可
        redisSecurityGroup.addIngressRule(
            fargateService.service.connections.securityGroups[0],
            ec2.Port.tcp(6379),
            'Allow from Fargate service'
        );

        // Route53とカスタムドメインの設定
        const domainName = this.node.tryGetContext('domainName');
        const useRoute53 = this.node.tryGetContext('useRoute53') === 'true';

        if (useRoute53 && domainName) {
            const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
                domainName
            });

            new route53.ARecord(this, 'ALBDnsRecord', {
                zone: hostedZone,
                target: route53.RecordTarget.fromAlias(
                    new targets.LoadBalancerTarget(fargateService.loadBalancer)
                ),
                recordName: `${this.envName}.${domainName}`,
            });

            // 環境変数にドメイン名を追加
            container.addEnvironment('DOMAIN_NAME', `${this.envName}.${domainName}`);
        }

        // CDK Outputs
        new cdk.CfnOutput(this, 'VpcId', {
            value: vpc.vpcId,
            description: 'VPC ID',
            exportName: `${this.projectPrefix}-${this.envName}-vpc-id`,
        });

        new cdk.CfnOutput(this, 'DatabaseEndpoint', {
            value: database.clusterEndpoint.hostname,
            description: 'Database endpoint',
            exportName: `${this.projectPrefix}-${this.envName}-db-endpoint`,
        });

        new cdk.CfnOutput(this, 'RedisEndpoint', {
            value: redis.attrPrimaryEndPointAddress,
            description: 'Redis endpoint',
            exportName: `${this.projectPrefix}-${this.envName}-redis-endpoint`,
        });

        new cdk.CfnOutput(this, 'RedisPort', {
            value: redis.attrPrimaryEndPointPort,
            description: 'Redis port',
            exportName: `${this.projectPrefix}-${this.envName}-redis-port`,
        });

        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: fargateService.loadBalancer.loadBalancerDnsName,
            description: 'Application Load Balancer DNS',
            exportName: `${this.projectPrefix}-${this.envName}-alb-dns`,
        });

        new cdk.CfnOutput(this, 'BucketName', {
            value: bucket.bucketName,
            description: 'S3 Bucket Name',
            exportName: `${this.projectPrefix}-${this.envName}-bucket-name`,
        });
    }
}
