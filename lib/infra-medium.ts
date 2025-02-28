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
export class InfraMediumStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // プロジェクト名と環境名を取得
        const projectName = this.node.tryGetContext('projectName') || 'MyProject';
        const environment = 'medium';

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
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED
            },
            serverlessV2MinCapacity: 0.5, // 最小0.5 ACU
            serverlessV2MaxCapacity: 4.0,  // 最大4.0 ACU
            writer: rds.ClusterInstance.serverlessV2('writer', {
                autoMinorVersionUpgrade: true,
                enablePerformanceInsights: true,
                performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT, // 7日間
            }),
            readers: [
                rds.ClusterInstance.serverlessV2('reader1', {
                    autoMinorVersionUpgrade: true,
                    enablePerformanceInsights: true,
                    performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
                    scaleWithWriter: true, // ライターと同じスケーリング設定を使用
                })
            ],
            backup: {
                retention: Duration.days(14), // バックアップ保持期間
                preferredWindow: '03:00-04:00', // JST 12:00-13:00
            },
            cloudwatchLogsExports: ['error', 'general', 'slowquery'], // ログエクスポートの有効化
            monitoringInterval: Duration.seconds(30), // 拡張モニタリングの有効化
            defaultDatabaseName: 'appdb',
        });

        // ECS Fargateクラスター
        const cluster = new ecs.Cluster(this, 'MediumCluster', {
            vpc,
            enableFargateCapacityProviders: true,
        });

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MediumService', {
            cluster,
            cpu: 512,
            memoryLimitMiB: 1024,
            desiredCount: 2,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'), // デモ用のイメージ
                containerPort: 80,
                environment: {
                    DATABASE_HOST: database.clusterEndpoint.hostname,
                    DATABASE_PORT: database.clusterEndpoint.port.toString(),
                    DATABASE_NAME: 'appdb',
                },
            },
            publicLoadBalancer: true,
        });

        // ECSサービスのAuto Scaling設定
        const scaling = fargateService.service.autoScaleTaskCount({
            minCapacity: 2,
            maxCapacity: 8,
        });

        // CPU使用率に基づくスケーリング
        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60),
        });

        // リクエスト数に基づくスケーリング
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

        const redis = new elasticache.CfnCacheCluster(this, 'MediumRedis', {
            engine: 'redis',
            cacheNodeType: 'cache.t3.medium',
            numCacheNodes: 1,
            vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
            cacheSubnetGroupName: redisSubnetGroup.ref,
            engineVersion: '7.0',
            preferredMaintenanceWindow: 'sun:23:00-mon:01:30',
            autoMinorVersionUpgrade: true,
        });

        // WAFの設定
        const wafAcl = new wafv2.CfnWebACL(this, 'MediumWAF', {
            defaultAction: { allow: {} },
            scope: 'CLOUDFRONT',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'MediumWAFMetrics',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'RateLimit',
                    priority: 1,
                    statement: {
                        rateBasedStatement: {
                            limit: 2000,
                            aggregateKeyType: 'IP',
                        },
                    },
                    action: { block: {} },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'RateLimitRule',
                        sampledRequestsEnabled: true,
                    },
                },
                {
                    name: 'AWSManagedRulesCommonRuleSet',
                    priority: 2,
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesCommonRuleSet',
                        },
                    },
                    overrideAction: { none: {} },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'AWSManagedRulesCommonRuleSetMetric',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });

        // カスタムドメインの設定（オプション）
        const domainName = this.node.tryGetContext('domainName');
        const useCustomDomain = this.node.tryGetContext('useCustomDomain') === 'true';

        let certificate;
        if (useCustomDomain && domainName) {
            // Route53のホストゾーンを参照
            const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
                domainName
            });

            // CloudFront用のACM証明書（us-east-1リージョンに作成）
            certificate = new acm.DnsValidatedCertificate(this, 'CloudFrontCertificate', {
                domainName: `*.${domainName}`,
                hostedZone,
                region: 'us-east-1', // CloudFront用の証明書はus-east-1に作成する必要がある
                validation: acm.CertificateValidation.fromDns(hostedZone),
            });
        }

        // CloudFrontディストリビューションの設定
        const distribution = new cloudfront.Distribution(this, 'MediumDistribution', {
            defaultBehavior: {
                origin: new origins.LoadBalancerV2Origin(fargateService.loadBalancer, {
                    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
            },
            domainNames: useCustomDomain && domainName ? [`${environment}.${domainName}`] : undefined,
            certificate: useCustomDomain && certificate ? certificate : undefined,
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            webAclId: wafAcl.attrArn,
            enableLogging: true,
            logBucket: new s3.Bucket(this, 'CloudFrontLogsBucket', {
                encryption: s3.BucketEncryption.S3_MANAGED,
                removalPolicy: RemovalPolicy.RETAIN,
                lifecycleRules: [
                    {
                        expiration: Duration.days(90),
                    }
                ]
            }),
        });

        // Route53 DNSレコードの作成（カスタムドメインが設定されている場合）
        if (useCustomDomain && domainName) {
            const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
                domainName
            });

            new route53.ARecord(this, 'CloudFrontAliasRecord', {
                zone: hostedZone,
                target: route53.RecordTarget.fromAlias(
                    new targets.CloudFrontTarget(distribution)
                ),
                recordName: `${environment}.${domainName}`,
            });
        }

        // CloudFrontディストリビューションからのS3バケットへのアクセスを許可
        bucket.addToResourcePolicy(new iam.PolicyStatement({
            actions: ['s3:GetObject'],
            resources: [bucket.arnForObjects('*')],
            principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
            conditions: {
                'StringEquals': {
                    'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
                }
            }
        }));

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
    }
}