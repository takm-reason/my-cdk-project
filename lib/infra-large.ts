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
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class InfraLargeStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

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
            instances: 3, // メイン + 2つのRead Replica
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
                domainName: 'example.com', // 実際のドメイン名に置き換えてください
            })],
        });

        // APIトラフィック用のリスナー
        const apiListener = alb.addListener('ApiListener', {
            port: 8443,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            certificates: [new acm.Certificate(this, 'ApiCertificate', {
                domainName: 'api.example.com', // 実際のドメイン名に置き換えてください
            })],
        });

        // メインアプリケーションのECSサービス
        const mainAppService = new ecs.FargateService(this, 'MainAppService', {
            cluster,
            taskDefinition: new ecs.FargateTaskDefinition(this, 'MainAppTask', {
                cpu: 1024,
                memoryLimitMiB: 2048,
            }),
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
            taskDefinition: new ecs.FargateTaskDefinition(this, 'ApiTask', {
                cpu: 1024,
                memoryLimitMiB: 2048,
            }),
            desiredCount: 3,
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(60),
            platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
            enableExecuteCommand: true,
        });

        // メインアプリケーションのターゲットグループ
        const mainTargetGroup = new elbv2.ApplicationTargetGroup(this, 'MainTargetGroup', {
            vpc,
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                path: '/health',
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
                timeout: Duration.seconds(10),
                interval: Duration.seconds(30),
            },
            deregistrationDelay: Duration.seconds(30),
        });

        // APIのターゲットグループ
        const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
            vpc,
            port: 8080,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                path: '/api/health',
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
                timeout: Duration.seconds(10),
                interval: Duration.seconds(30),
            },
            deregistrationDelay: Duration.seconds(30),
        });

        // ターゲットグループをリスナーに追加
        httpsListener.addTargetGroups('MainTargetGroup', {
            targetGroups: [mainTargetGroup],
        });

        apiListener.addTargetGroups('ApiTargetGroup', {
            targetGroups: [apiTargetGroup],
        });

        // ECSサービスをターゲットグループに登録
        mainAppService.attachToApplicationTargetGroup(mainTargetGroup);
        apiService.attachToApplicationTargetGroup(apiTargetGroup);

        // Auto Scaling設定（メインアプリケーション）
        const mainScaling = mainAppService.autoScaleTaskCount({
            minCapacity: 3,
            maxCapacity: 12,
        });

        mainScaling.scaleOnCpuUtilization('MainCpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60),
        });

        // Auto Scaling設定（APIサービス）
        const apiScaling = apiService.autoScaleTaskCount({
            minCapacity: 3,
            maxCapacity: 12,
        });

        apiScaling.scaleOnCpuUtilization('ApiCpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60),
        });

        // RDSへのアクセスを許可
        database.connections.allowFrom(
            mainAppService,
            ec2.Port.tcp(3306),
            'Allow from main Fargate service'
        );

        database.connections.allowFrom(
            apiService,
            ec2.Port.tcp(3306),
            'Allow from API Fargate service'
        );

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

        // WAF（高度な設定）
        const wafAcl = new wafv2.CfnWebACL(this, 'LargeWAF', {
            defaultAction: { allow: {} },
            scope: 'CLOUDFRONT',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'LargeWAFMetrics',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'RateLimit',
                    priority: 1,
                    statement: {
                        rateBasedStatement: {
                            limit: 3000,
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
                {
                    name: 'AWSManagedRulesKnownBadInputsRuleSet',
                    priority: 3,
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesKnownBadInputsRuleSet',
                        },
                    },
                    overrideAction: { none: {} },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'KnownBadInputsRuleSetMetric',
                        sampledRequestsEnabled: true,
                    },
                },
                {
                    name: 'AWSManagedRulesSQLiRuleSet',
                    priority: 4,
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesSQLiRuleSet',
                        },
                    },
                    overrideAction: { none: {} },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'SQLiRuleSetMetric',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });

        // AWS Shield Advancedの有効化
        const shieldProtection = new shield.CfnProtection(this, 'ShieldProtection', {
            name: 'LargeEnvironmentProtection',
            resourceArn: alb.loadBalancerArn,
        });

        // CloudFrontディストリビューションの設定（高度な設定）
        const distribution = new cloudfront.Distribution(this, 'LargeDistribution', {
            defaultBehavior: {
                origin: new origins.LoadBalancerV2Origin(alb, {
                    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
                    httpsPort: 443,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                compress: true,
            },
            additionalBehaviors: {
                '/api/*': {
                    origin: new origins.LoadBalancerV2Origin(alb, {
                        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
                        httpsPort: 8443,
                    }),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                },
            },
            priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
            webAclId: wafAcl.attrArn,
            enableLogging: true,
            errorResponses: [
                {
                    httpStatus: 403,
                    responsePagePath: '/error/403.html',
                    responseHttpStatus: 403,
                    ttl: Duration.minutes(30),
                },
                {
                    httpStatus: 404,
                    responsePagePath: '/error/404.html',
                    responseHttpStatus: 404,
                    ttl: Duration.minutes(30),
                },
            ],
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

        // 環境変数にRedisエンドポイントを追加
        const mainAppTaskDef = mainAppService.taskDefinition;
        const apiTaskDef = apiService.taskDefinition;

        mainAppTaskDef.defaultContainer?.addEnvironment(
            'REDIS_ENDPOINT',
            redisCluster.attrConfigurationEndPointAddress
        );
        mainAppTaskDef.defaultContainer?.addEnvironment(
            'REDIS_PORT',
            redisCluster.attrConfigurationEndPointPort
        );

        apiTaskDef.defaultContainer?.addEnvironment(
            'REDIS_ENDPOINT',
            redisCluster.attrConfigurationEndPointAddress
        );
        apiTaskDef.defaultContainer?.addEnvironment(
            'REDIS_PORT',
            redisCluster.attrConfigurationEndPointPort
        );
    }
}