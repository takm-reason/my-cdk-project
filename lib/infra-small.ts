import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class InfraSmallStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // プロジェクト名と環境名を取得
        const projectName = this.node.tryGetContext('projectName') || 'MyProject';
        const environment = 'small';
        const domainName = this.node.tryGetContext('domainName');
        const useRoute53 = this.node.tryGetContext('useRoute53') === 'true';

        // ランダムなサフィックスを生成（8文字）
        const suffix = Math.random().toString(36).substring(2, 10);

        // S3バケットの作成
        const bucket = new s3.Bucket(this, 'StorageBucket', {
            bucketName: `${projectName.toLowerCase()}-${environment}-${suffix}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.RETAIN,
            lifecycleRules: [
                {
                    // 有効期限は設定せず、ライフサイクルルールのみを適用
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
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
            allocatedStorage: 20,
            maxAllocatedStorage: 30,
            databaseName: 'appdb',
            multiAz: false,
            deletionProtection: false,
            backupRetention: cdk.Duration.days(7),
        });

        // ECS Fargateクラスター
        const cluster = new ecs.Cluster(this, 'SmallCluster', {
            vpc,
            enableFargateCapacityProviders: true,
        });

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'SmallService', {
            cluster,
            cpu: 256,
            memoryLimitMiB: 512,
            desiredCount: 1,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'), // デモ用のイメージ
                containerPort: 80,
                environment: {
                    // データベース接続情報など
                    DATABASE_HOST: database.instanceEndpoint.hostname,
                    DATABASE_PORT: database.instanceEndpoint.port.toString(),
                    DATABASE_NAME: 'appdb',
                },
            },
            publicLoadBalancer: true,
            minHealthyPercent: 50,
            maxHealthyPercent: 100, // Auto Scalingを無効化（同時に実行できるタスク数を1に制限）
        });

        // RDSへのアクセスを許可
        database.connections.allowFrom(
            fargateService.service,
            ec2.Port.tcp(3306),
            'Allow from Fargate service'
        );

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

        const redis = new elasticache.CfnCacheCluster(this, 'SmallRedis', {
            engine: 'redis',
            cacheNodeType: 'cache.t3.medium',
            numCacheNodes: 1,
            vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
            cacheSubnetGroupName: redisSubnetGroup.ref,
            engineVersion: '7.0',
            preferredMaintenanceWindow: 'sun:23:00-mon:01:30',
            autoMinorVersionUpgrade: true,
        });

        // RedisへのアクセスをFargateサービスに許可
        redisSecurityGroup.addIngressRule(
            fargateService.service.connections.securityGroups[0],
            ec2.Port.tcp(6379),
            'Allow from Fargate service'
        );

        // 環境変数にRedisエンドポイントを追加
        fargateService.taskDefinition.defaultContainer?.addEnvironment(
            'REDIS_ENDPOINT',
            redis.attrRedisEndpointAddress
        );
        fargateService.taskDefinition.defaultContainer?.addEnvironment(
            'REDIS_PORT',
            redis.attrRedisEndpointPort
        );

        // Route53統合（オプション）
        if (useRoute53 && domainName) {
            // 既存のホストゾーンを参照
            const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
                domainName: domainName
            });

            // ALBのDNSレコードを作成
            new route53.ARecord(this, 'ALBDnsRecord', {
                zone: hostedZone,
                target: route53.RecordTarget.fromAlias(
                    new targets.LoadBalancerTarget(fargateService.loadBalancer)
                ),
                recordName: `${environment}.${domainName}`, // small.example.com
                ttl: cdk.Duration.minutes(5),
            });

            // 環境変数にドメイン名を追加
            fargateService.taskDefinition.defaultContainer?.addEnvironment(
                'DOMAIN_NAME',
                `${environment}.${domainName}`
            );
        }
    }
}