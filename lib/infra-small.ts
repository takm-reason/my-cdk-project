import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { InfrastructureStack, InfraBaseStackProps } from './infra-base-stack';

export class InfraSmallStack extends InfrastructureStack {
    constructor(scope: Construct, id: string, props: InfraBaseStackProps) {
        super(scope, id, props);

        const domainName = this.node.tryGetContext('domainName');
        const useRoute53 = this.node.tryGetContext('useRoute53') === 'true';

        // S3バケットの作成
        const bucket = new s3.Bucket(this, 'StorageBucket', {
            bucketName: `${this.projectPrefix.toLowerCase()}-${this.envName}-${this.resourceSuffix}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.RETAIN,
            lifecycleRules: [
                {
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        },
                        {
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(90),
                        }
                    ]
                }
            ]
        });

        // Small環境用のVPC設定
        const vpc = new ec2.Vpc(this, 'SmallVPC', {
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
                }
            ]
        });

        // Small環境用のRDSインスタンス
        const database = new rds.DatabaseInstance(this, 'SmallDatabase', {
            engine: rds.DatabaseInstanceEngine.mysql({
                version: rds.MysqlEngineVersion.VER_8_0
            }),
            vpc,
            credentials: rds.Credentials.fromSecret(this.databaseSecret),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
            allocatedStorage: 20,
            maxAllocatedStorage: 30,
            databaseName: 'appdb',
            multiAz: false,
            deletionProtection: false, // 開発環境なのでfalse
            removalPolicy: RemovalPolicy.DESTROY, // 開発環境なのでDESTROY
            backupRetention: cdk.Duration.days(7),
        });

        // ElastiCache (Redis)の設定
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
            description: 'Subnet group for Redis cache',
        });

        const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
            vpc,
            description: 'Security group for Redis cache',
            allowAllOutbound: true,
        });

        // Redis ReplicationGroupの作成（自動フェイルオーバー無効）
        const redis = new elasticache.CfnReplicationGroup(this, 'SmallRedis', {
            replicationGroupDescription: 'Redis cluster for small environment',
            engine: 'redis',
            cacheNodeType: 'cache.t3.medium',
            numCacheClusters: 1,
            securityGroupIds: [redisSecurityGroup.securityGroupId],
            cacheSubnetGroupName: redisSubnetGroup.ref,
            engineVersion: '7.0',
            preferredMaintenanceWindow: 'sun:23:00-mon:01:30',
            autoMinorVersionUpgrade: true,
            transitEncryptionEnabled: true,
            atRestEncryptionEnabled: true,
            automaticFailoverEnabled: false, // 自動フェイルオーバーを無効化
        });

        // ECS Fargateクラスター
        const cluster = new ecs.Cluster(this, 'SmallCluster', {
            vpc,
            enableFargateCapacityProviders: true,
        });

        // ECSタスク定義でのコンテナ環境変数設定
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'SmallTaskDef', {
            cpu: 256,
            memoryLimitMiB: 512,
        });

        const container = taskDefinition.addContainer('AppContainer', {
            image: ecs.ContainerImage.fromRegistry('nginx:latest'), // デモ用のイメージ
            secrets: {
                DATABASE_USERNAME: ecs.Secret.fromSecretsManager(this.databaseSecret, 'username'),
                DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(this.databaseSecret, 'password'),
                REDIS_AUTH_TOKEN: ecs.Secret.fromSecretsManager(this.redisSecret, 'authToken'),
            },
            environment: {
                DATABASE_HOST: database.instanceEndpoint.hostname,
                DATABASE_PORT: database.instanceEndpoint.port.toString(),
                DATABASE_NAME: 'appdb',
                RAILS_ENV: 'development', // 開発環境なのでdevelopment
                REDIS_URL: redis.attrPrimaryEndPointAddress,
                REDIS_PORT: redis.attrPrimaryEndPointPort,
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'small-service',
            }),
        });

        container.addPortMappings({
            containerPort: 80,
            protocol: ecs.Protocol.TCP,
        });

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'SmallService', {
            cluster,
            taskDefinition,
            publicLoadBalancer: true,
            desiredCount: 1,
            minHealthyPercent: 50,
            maxHealthyPercent: 100,
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

        // Route53統合（オプション）
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
            value: database.instanceEndpoint.hostname,
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