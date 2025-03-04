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

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MediumService', {
            cluster,
            cpu: 512,
            memoryLimitMiB: 1024,
            desiredCount: 2,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'),
                containerPort: 80,
                secrets: {
                    DATABASE_USERNAME: ecs.Secret.fromSecretsManager(this.databaseSecret, 'username'),
                    DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(this.databaseSecret, 'password'),
                    REDIS_AUTH_TOKEN: ecs.Secret.fromSecretsManager(this.redisSecret),
                },
                environment: {
                    DATABASE_HOST: database.clusterEndpoint.hostname,
                    DATABASE_PORT: database.clusterEndpoint.port.toString(),
                    DATABASE_NAME: 'appdb',
                    RAILS_ENV: 'production',
                },
            },
            publicLoadBalancer: true,
        });

        // ECSサービスのAuto Scaling設定
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
            numCacheClusters: 1,
            securityGroupIds: [redisSecurityGroup.securityGroupId],
            cacheSubnetGroupName: redisSubnetGroup.ref,
            engineVersion: '7.0',
            preferredMaintenanceWindow: 'sun:23:00-mon:01:30',
            autoMinorVersionUpgrade: true,
            transitEncryptionEnabled: true,
            atRestEncryptionEnabled: true,
            authToken: this.getRedisSecretValue(),
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

        // カスタムドメインの設定
        const domainName = this.node.tryGetContext('domainName');
        const useCustomDomain = this.node.tryGetContext('useCustomDomain') === 'true';

        let certificate;
        if (useCustomDomain && domainName) {
            const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
                domainName
            });

            certificate = new acm.DnsValidatedCertificate(this, 'CloudFrontCertificate', {
                domainName: `*.${domainName}`,
                hostedZone,
                region: 'us-east-1',
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
            domainNames: useCustomDomain && domainName ? [`${this.envName}.${domainName}`] : undefined,
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

        // Route53 DNSレコードの作成
        if (useCustomDomain && domainName) {
            const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
                domainName
            });

            new route53.ARecord(this, 'CloudFrontAliasRecord', {
                zone: hostedZone,
                target: route53.RecordTarget.fromAlias(
                    new targets.CloudFrontTarget(distribution)
                ),
                recordName: `${this.envName}.${domainName}`,
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

        new cdk.CfnOutput(this, 'CloudFrontDomain', {
            value: distribution.distributionDomainName,
            description: 'CloudFront Distribution Domain Name',
            exportName: `${this.projectPrefix}-${this.envName}-cloudfront-domain`,
        });

        new cdk.CfnOutput(this, 'BucketName', {
            value: bucket.bucketName,
            description: 'S3 Bucket Name',
            exportName: `${this.projectPrefix}-${this.envName}-bucket-name`,
        });
    }
}