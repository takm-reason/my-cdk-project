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
                REDIS_AUTH_TOKEN: ecs.Secret.fromSecretsManager(this.redisSecret),
            },
            environment: {
                DATABASE_HOST: database.clusterEndpoint.hostname,
                DATABASE_PORT: database.clusterEndpoint.port.toString(),
                DATABASE_NAME: 'appdb',
                RAILS_ENV: 'production',
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
                REDIS_AUTH_TOKEN: ecs.Secret.fromSecretsManager(this.redisSecret),
            },
            environment: {
                DATABASE_HOST: database.clusterEndpoint.hostname,
                DATABASE_PORT: database.clusterEndpoint.port.toString(),
                DATABASE_NAME: 'appdb',
                RAILS_ENV: 'production',
            },
            logging: new ecs.AwsLogDriver({
                streamPrefix: 'api',
                logRetention: logs.RetentionDays.ONE_MONTH,
            }),
        });

        mainContainer.addPortMappings({ containerPort: 80 });
        apiContainer.addPortMappings({ containerPort: 8080 });

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
            authToken: this.getRedisSecretValue(),
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
            logBucket: new s3.Bucket(this, 'CloudFrontLogsBucket', {
                encryption: s3.BucketEncryption.S3_MANAGED,
                removalPolicy: RemovalPolicy.RETAIN,
                lifecycleRules: [
                    {
                        expiration: Duration.days(90),
                    }
                ]
            }),
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

        // CI/CDパイプライン関連のリソース
        const repository = new codecommit.Repository(this, 'ApplicationRepo', {
            repositoryName: 'large-app-repository',
            description: 'Application source code repository'
        });

        const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REPO_URI',
                            'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                            'IMAGE_TAG=$${COMMIT_HASH:=latest}'
                        ]
                    },
                    build: {
                        commands: [
                            'docker build -t $ECR_REPO_URI:$IMAGE_TAG .',
                            'docker tag $ECR_REPO_URI:$IMAGE_TAG $ECR_REPO_URI:latest'
                        ]
                    },
                    post_build: {
                        commands: [
                            'docker push $ECR_REPO_URI:$IMAGE_TAG',
                            'docker push $ECR_REPO_URI:latest',
                            'echo Writing image definitions file...',
                            'printf \'{"ImageURI":"%s"}\' $ECR_REPO_URI:$IMAGE_TAG > imageDefinitions.json'
                        ]
                    }
                },
                artifacts: {
                    files: ['imageDefinitions.json']
                }
            }),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                privileged: true,
                environmentVariables: {
                    ECR_REPO_URI: {
                        value: mainContainer.containerName
                    }
                }
            },
            logging: {
                cloudWatch: {
                    enabled: true,
                    logGroup: new logs.LogGroup(this, 'BuildLogGroup', {
                        logGroupName: '/codebuild/app-build',
                        retention: logs.RetentionDays.ONE_MONTH,
                        removalPolicy: cdk.RemovalPolicy.DESTROY
                    })
                }
            }
        });

        const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
            pipelineName: 'LargeAppPipeline',
            crossAccountKeys: false,
            restartExecutionOnUpdate: true
        });

        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new codepipeline_actions.CodeCommitSourceAction({
                    actionName: 'CodeCommit_Source',
                    repository: repository,
                    branch: 'main',
                    output: new codepipeline.Artifact('SourceOutput')
                })
            ]
        });

        pipeline.addStage({
            stageName: 'Build',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'Build',
                    project: buildProject,
                    input: new codepipeline.Artifact('SourceOutput'),
                    outputs: [new codepipeline.Artifact('BuildOutput')]
                })
            ]
        });

        pipeline.addStage({
            stageName: 'Deploy',
            actions: [
                new codepipeline_actions.EcsDeployAction({
                    actionName: 'Deploy_to_ECS',
                    service: mainAppService,
                    input: new codepipeline.Artifact('BuildOutput')
                })
            ]
        });

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
            description: 'Redis endpoint',
            exportName: `${this.projectPrefix}-${this.envName}-redis-endpoint`,
        });

        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: alb.loadBalancerDnsName,
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