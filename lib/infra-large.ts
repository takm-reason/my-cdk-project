import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as shield from 'aws-cdk-lib/aws-shield';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { InfrastructureStack, InfraBaseStackProps } from './infra-base-stack';

export class InfraLargeStack extends InfrastructureStack {
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
                    expiration: cdk.Duration.days(365 * 3), // 3年
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
                            transitionAfter: cdk.Duration.days(90),
                        },
                        {
                            storageClass: s3.StorageClass.DEEP_ARCHIVE,
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
            serverAccessLogsPrefix: 'access-logs/',
            intelligentTieringConfigurations: [
                {
                    name: 'archive-old-objects',
                    archiveAccessTierTime: cdk.Duration.days(90),
                    deepArchiveAccessTierTime: cdk.Duration.days(180),
                }
            ],
        });

        // Large環境用のVPC設定
        const vpc = new ec2.Vpc(this, 'LargeVPC', {
            maxAzs: 3,
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

        // Large環境用のAuroraクラスター
        const database = new rds.DatabaseCluster(this, 'LargeDatabase', {
            engine: rds.DatabaseClusterEngine.auroraMysql({
                version: rds.AuroraMysqlEngineVersion.VER_3_04_0
            }),
            credentials: rds.Credentials.fromSecret(this.databaseSecret),
            instances: 3,
            instanceProps: {
                vpc,
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED
                }
            },
            backup: {
                retention: Duration.days(30),
            },
            defaultDatabaseName: 'appdb',
            deletionProtection: true,
            iamAuthentication: true,
            monitoringInterval: Duration.seconds(30),
            storageEncrypted: true,
        });

        // ECS Fargateクラスター（マルチAZ）
        const cluster = new ecs.Cluster(this, 'LargeCluster', {
            vpc,
            enableFargateCapacityProviders: true,
            containerInsights: true,
        });

        // ALBの作成
        const alb = new elbv2.ApplicationLoadBalancer(this, 'LargeALB', {
            vpc,
            internetFacing: true,
            deletionProtection: true,
        });

        // HTTPリスナー（HTTPSへリダイレクト）
        const httpListener = alb.addListener('HttpListener', {
            port: 80,
            defaultAction: elbv2.ListenerAction.redirect({
                protocol: 'HTTPS',
                port: '443',
                permanent: true,
            }),
        });

        // HTTPSリスナー（メインアプリケーション用）
        const httpsListener = alb.addListener('HttpsListener', {
            port: 443,
            certificates: [new acm.Certificate(this, 'Certificate', {
                domainName: 'example.com',
            })],
        });

        // APIトラフィック用のリスナー
        const apiListener = alb.addListener('ApiListener', {
            port: 8443,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            certificates: [new acm.Certificate(this, 'ApiCertificate', {
                domainName: 'api.example.com',
            })],
        });

        // ElastiCache (Redis Cluster)の設定
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
            description: 'Subnet group for Redis cluster',
        });

        const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
            vpc,
            description: 'Security group for Redis cluster',
            allowAllOutbound: true,
        });

        const redisCluster = new elasticache.CfnReplicationGroup(this, 'LargeRedisCluster', {
            replicationGroupDescription: 'Large environment Redis cluster',
            engine: 'redis',
            cacheNodeType: 'cache.r6g.large',
            numNodeGroups: 3,
            replicasPerNodeGroup: 2,
            automaticFailoverEnabled: true,
            multiAzEnabled: true,
            cacheSubnetGroupName: redisSubnetGroup.ref,
            securityGroupIds: [redisSecurityGroup.securityGroupId],
            engineVersion: '7.0',
            port: 6379,
            preferredMaintenanceWindow: 'sun:23:00-mon:01:30',
            autoMinorVersionUpgrade: true,
            atRestEncryptionEnabled: true,
            transitEncryptionEnabled: true,
        });

        // メインアプリケーションのタスク定義
        const mainAppTaskDef = new ecs.FargateTaskDefinition(this, 'MainAppTask', {
            cpu: 1024,
            memoryLimitMiB: 2048,
        });

        // APIサービスのタスク定義
        const apiTaskDef = new ecs.FargateTaskDefinition(this, 'ApiTask', {
            cpu: 1024,
            memoryLimitMiB: 2048,
        });

        // コンテナの環境変数とシークレットの設定
        const mainContainer = mainAppTaskDef.addContainer('MainAppContainer', {
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
                REDIS_URL: redisCluster.attrConfigurationEndPointAddress,
                REDIS_PORT: redisCluster.attrConfigurationEndPointPort,
            },
            logging: new ecs.AwsLogDriver({
                streamPrefix: 'main-app',
                logRetention: logs.RetentionDays.ONE_MONTH,
            }),
        });

        const apiContainer = apiTaskDef.addContainer('ApiContainer', {
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
                REDIS_URL: redisCluster.attrConfigurationEndPointAddress,
                REDIS_PORT: redisCluster.attrConfigurationEndPointPort,
            },
            logging: new ecs.AwsLogDriver({
                streamPrefix: 'api',
                logRetention: logs.RetentionDays.ONE_MONTH,
            }),
        });

        mainContainer.addPortMappings({
            containerPort: 80,
            protocol: ecs.Protocol.TCP,
        });
        apiContainer.addPortMappings({
            containerPort: 8080,
            protocol: ecs.Protocol.TCP,
        });

        // メインアプリケーションのECSサービス
        const mainAppService = new ecs.FargateService(this, 'MainAppService', {
            cluster,
            taskDefinition: mainAppTaskDef,
            desiredCount: 3,
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(60),
            platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
            enableExecuteCommand: true,
        });

        // APIサービスのECSサービス
        const apiService = new ecs.FargateService(this, 'ApiService', {
            cluster,
            taskDefinition: apiTaskDef,
            desiredCount: 3,
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(60),
            platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
            enableExecuteCommand: true,
        });

        // RedisへのアクセスをFargateサービスに許可
        redisSecurityGroup.addIngressRule(
            mainAppService.connections.securityGroups[0],
            ec2.Port.tcp(6379),
            'Allow from main Fargate service'
        );

        redisSecurityGroup.addIngressRule(
            apiService.connections.securityGroups[0],
            ec2.Port.tcp(6379),
            'Allow from API Fargate service'
        );

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
            value: redisCluster.attrConfigurationEndPointAddress,
            description: 'Redis configuration endpoint',
            exportName: `${this.projectPrefix}-${this.envName}-redis-endpoint`,
        });

        new cdk.CfnOutput(this, 'RedisPort', {
            value: redisCluster.attrConfigurationEndPointPort,
            description: 'Redis port',
            exportName: `${this.projectPrefix}-${this.envName}-redis-port`,
        });

        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: alb.loadBalancerDnsName,
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