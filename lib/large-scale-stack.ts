import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as shield from 'aws-cdk-lib/aws-shield';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ResourceRecorder } from './utils/resource-recorder';
import { TagPolicyManager } from './utils/tag-policies';

export interface LargeScaleStackProps extends cdk.StackProps {
    projectName: string;
    environment?: string;
}

export class LargeScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: LargeScaleStackProps) {
        super(scope, id, props);

        const recorder = new ResourceRecorder(props.projectName);

        // タグポリシーマネージャーの初期化
        const tagPolicyManager = new TagPolicyManager({
            scope: this,
            projectName: props.projectName,
        });

        // AWS Config ルールの作成
        tagPolicyManager.createTagComplianceRule();

        // Tag Policyテンプレートの生成（Organizations管理者に提供）
        const tagPolicyTemplate = tagPolicyManager.generateTagPolicyTemplate();
        new cdk.CfnOutput(this, 'TagPolicyTemplate', {
            value: tagPolicyTemplate,
            description: 'Organizations Tag Policyテンプレート',
        });

        // スタック全体にタグを追加
        cdk.Tags.of(this).add('Project', props.projectName);
        cdk.Tags.of(this).add('Environment', props.environment || 'development');
        cdk.Tags.of(this).add('CreatedBy', 'cdk');
        cdk.Tags.of(this).add('CreatedAt', new Date().toISOString().split('T')[0]);

        // VPCの作成（マルチAZ）
        const vpc = new ec2.Vpc(this, 'LargeScaleVPC', {
            maxAzs: 3,
            natGateways: 3,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 23,
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 23,
                    name: 'Isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                }
            ],
        });

        // VPCにタグを追加
        cdk.Tags.of(vpc).add('Name', `${props.projectName}-large-vpc`);

        // VPC情報の記録
        recorder.recordVpc(vpc, this.stackName);

        // Aurora Global Databaseの作成
        const globalCluster = new rds.CfnGlobalCluster(this, 'AuroraGlobalCluster', {
            globalClusterIdentifier: `${props.projectName}-global-db`,
            engineVersion: '15.2',
            engine: 'aurora-postgresql',
            storageEncrypted: true,
            deletionProtection: true,
        });

        // プライマリクラスターの作成
        const primaryCluster = new rds.DatabaseCluster(this, 'AuroraPrimaryCluster', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_15_2,
            }),
            instanceProps: {
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
                vpc,
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            },
            instances: 3,
            backup: {
                retention: cdk.Duration.days(30),
                preferredWindow: '03:00-04:00',
            },
            cloudwatchLogsRetention: logs.RetentionDays.THREE_MONTHS,
            storageEncrypted: true,
        });

        // プライマリクラスターをグローバルクラスターに関連付け
        const cfnDbCluster = primaryCluster.node.defaultChild as rds.CfnDBCluster;
        cfnDbCluster.globalClusterIdentifier = globalCluster.ref;

        // セカンダリリージョンのスタックを作成するためのパラメータを出力
        new cdk.CfnOutput(this, 'GlobalClusterArn', {
            value: globalCluster.ref,
            description: 'Aurora Global Cluster ARN for secondary region stack',
            exportName: 'AuroraGlobalClusterArn',
        });

        // Auroraクラスターにタグを追加
        cdk.Tags.of(primaryCluster).add('Name', `${props.projectName}-large-aurora`);

        // Aurora情報の記録
        recorder.recordRds(primaryCluster, this.stackName);

        // ElastiCache (Redis) Clusterの作成
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            description: 'Subnet group for Redis cluster',
            subnetIds: vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            }).subnetIds,
        });

        const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
            vpc,
            description: 'Security group for Redis cluster',
            allowAllOutbound: true,
        });

        const redisParameterGroup = new elasticache.CfnParameterGroup(this, 'RedisParameterGroup', {
            cacheParameterGroupFamily: 'redis6.x',
            description: 'Parameter group for Redis cluster',
        });

        const redisCluster = new elasticache.CfnReplicationGroup(this, 'RedisCluster', {
            replicationGroupDescription: 'Redis cluster for large scale application',
            engine: 'redis',
            cacheNodeType: 'cache.r6g.large',
            numNodeGroups: 3,
            replicasPerNodeGroup: 2,
            automaticFailoverEnabled: true,
            multiAzEnabled: true,
            cacheParameterGroupName: redisParameterGroup.ref,
            engineVersion: '6.x',
            port: 6379,
            securityGroupIds: [redisSecurityGroup.securityGroupId],
            cacheSubnetGroupName: redisSubnetGroup.ref,
        });

        // Redisクラスターにタグを追加
        cdk.Tags.of(redisCluster).add('Name', `${props.projectName}-large-redis`);

        // Redis情報の記録
        recorder.recordElastiCache(redisCluster, this.stackName);

        // S3バケットの作成
        const staticAssetsBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
            versioned: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            cors: [
                {
                    allowedHeaders: ['*'],
                    allowedMethods: [s3.HttpMethods.GET],
                    allowedOrigins: ['*'],
                    maxAge: 3000,
                },
            ],
            lifecycleRules: [
                {
                    expiration: cdk.Duration.days(365),
                    noncurrentVersionExpiration: cdk.Duration.days(30),
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: cdk.Duration.days(90),
                        },
                    ],
                },
            ],
        });

        // S3バケットにタグを追加
        cdk.Tags.of(staticAssetsBucket).add('Name', `${props.projectName}-large-static-assets`);

        // CloudFrontログバケットの作成
        const cfLogsBucket = new s3.Bucket(this, 'CloudFrontLogsBucket');
        cdk.Tags.of(cfLogsBucket).add('Name', `${props.projectName}-large-cf-logs`);

        // S3情報の記録
        recorder.recordS3(staticAssetsBucket, this.stackName);
        recorder.recordS3(cfLogsBucket, this.stackName);

        // CloudFrontディストリビューションの作成
        const distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
            defaultBehavior: {
                origin: new origins.S3Origin(staticAssetsBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
            },
            enableLogging: true,
            logBucket: cfLogsBucket,
            logFilePrefix: 'cloudfront-logs/',
        });

        // CloudFrontにタグを追加
        cdk.Tags.of(distribution).add('Name', `${props.projectName}-large-cf`);

        // CloudFront情報の記録
        recorder.recordCloudFront(distribution, this.stackName);

        // ECSクラスターの作成
        const cluster = new ecs.Cluster(this, 'LargeScaleCluster', {
            vpc,
            containerInsights: true,
            enableFargateCapacityProviders: true,
        });

        // ECSクラスターにタグを追加
        cdk.Tags.of(cluster).add('Name', `${props.projectName}-large-cluster`);

        // APIサービスの作成
        const apiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'ApiService', {
            cluster,
            memoryLimitMiB: 4096,
            cpu: 2048,
            desiredCount: 10,
            publicLoadBalancer: true,
            assignPublicIp: false,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('api-image:latest'),
                environment: {
                    DATABASE_URL: primaryCluster.clusterEndpoint.socketAddress,
                    REDIS_URL: `redis://${redisCluster.attrConfigurationEndPointAddress}:${redisCluster.attrConfigurationEndPointPort}`,
                },
                logDriver: ecs.LogDrivers.awsLogs({
                    streamPrefix: 'api-service',
                    logRetention: logs.RetentionDays.THREE_MONTHS,
                }),
            },
        });

        // APIサービスにタグを追加
        cdk.Tags.of(apiService.service).add('Name', `${props.projectName}-large-api-service`);
        cdk.Tags.of(apiService.loadBalancer).add('Name', `${props.projectName}-large-api-alb`);

        // フロントエンドサービスの作成
        const frontendService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'FrontendService', {
            cluster,
            memoryLimitMiB: 2048,
            cpu: 1024,
            desiredCount: 10,
            publicLoadBalancer: true,
            assignPublicIp: false,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('frontend-image:latest'),
                environment: {
                    API_URL: apiService.loadBalancer.loadBalancerDnsName,
                    CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
                },
                logDriver: ecs.LogDrivers.awsLogs({
                    streamPrefix: 'frontend-service',
                    logRetention: logs.RetentionDays.THREE_MONTHS,
                }),
            },
        });

        // フロントエンドサービスにタグを追加
        cdk.Tags.of(frontendService.service).add('Name', `${props.projectName}-large-frontend-service`);
        cdk.Tags.of(frontendService.loadBalancer).add('Name', `${props.projectName}-large-frontend-alb`);

        // ECS情報の記録
        recorder.recordEcs(cluster, apiService, this.stackName);
        recorder.recordEcs(cluster, frontendService, this.stackName);

        // Auto Scalingの設定
        const apiScaling = apiService.service.autoScaleTaskCount({
            maxCapacity: 50,
            minCapacity: 10,
        });

        apiScaling.scaleOnCpuUtilization('ApiCpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });

        const frontendScaling = frontendService.service.autoScaleTaskCount({
            maxCapacity: 30,
            minCapacity: 10,
        });

        frontendScaling.scaleOnCpuUtilization('FrontendCpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });

        // WAF + Shield Advancedの設定
        const wafAcl = new wafv2.CfnWebACL(this, 'WAFWebACL', {
            defaultAction: { allow: {} },
            scope: 'CLOUDFRONT',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'WAFWebACLMetric',
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: 'AWSManagedRulesCommonRuleSet',
                    priority: 1,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesCommonRuleSet',
                            vendorName: 'AWS',
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
                    name: 'RateLimit',
                    priority: 2,
                    statement: {
                        rateBasedStatement: {
                            limit: 2000,
                            aggregateKeyType: 'IP',
                        },
                    },
                    action: { block: {} },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'RateLimitMetric',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });

        // WAFにタグを追加
        cdk.Tags.of(wafAcl).add('Name', `${props.projectName}-large-waf`);

        // WAF情報の記録
        recorder.recordWaf(wafAcl, this.stackName);

        // Shield Advancedの保護
        const shieldProtection = new shield.CfnProtection(this, 'ShieldProtection', {
            name: 'LargeScaleProtection',
            resourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        });

        // Shieldにタグを追加
        cdk.Tags.of(shieldProtection).add('Name', `${props.projectName}-large-shield`);

        // Shield情報の記録
        recorder.recordShieldProtection(shieldProtection, this.stackName);

        // CI/CDパイプラインの作成
        const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
            pipelineName: 'LargeScaleDeploymentPipeline',
        });

        // パイプラインにタグを追加
        cdk.Tags.of(pipeline).add('Name', `${props.projectName}-large-pipeline`);

        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new codepipeline_actions.GitHubSourceAction({
                    actionName: 'GitHub_Source',
                    owner: 'your-github-owner',
                    repo: 'your-repo-name',
                    branch: 'main',
                    oauthToken: cdk.SecretValue.secretsManager('github-token'),
                    output: sourceOutput,
                }),
            ],
        });

        const buildProject = new codebuild.PipelineProject(this, 'BuildProject');
        cdk.Tags.of(buildProject).add('Name', `${props.projectName}-large-build`);

        pipeline.addStage({
            stageName: 'Build',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'Build',
                    project: buildProject,
                    input: sourceOutput,
                    outputs: [buildOutput],
                }),
            ],
        });

        // Pipeline情報の記録
        recorder.recordCodePipeline(pipeline, this.stackName);

        // CloudWatchダッシュボードの作成
        const dashboard = new cloudwatch.Dashboard(this, 'LargeScaleDashboard', {
            dashboardName: 'LargeScaleApplicationMetrics',
        });

        // ダッシュボードにタグを追加
        cdk.Tags.of(dashboard).add('Name', `${props.projectName}-large-dashboard`);

        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'ECS CPU Utilization',
                left: [
                    apiService.service.metricCpuUtilization(),
                    frontendService.service.metricCpuUtilization(),
                ],
            }),
            new cloudwatch.GraphWidget({
                title: 'ALB Request Count',
                left: [
                    apiService.loadBalancer.metricRequestCount(),
                    frontendService.loadBalancer.metricRequestCount(),
                ],
            })
        );

        // CloudWatchダッシュボード情報の記録
        recorder.recordCloudWatchDashboard(dashboard, this.stackName);

        // Systems Manager Parameter Storeの設定
        const databaseUrlParam = new ssm.StringParameter(this, 'DatabaseUrl', {
            parameterName: '/prod/database/url',
            stringValue: primaryCluster.clusterEndpoint.socketAddress,
        });

        const redisUrlParam = new ssm.StringParameter(this, 'RedisUrl', {
            parameterName: '/prod/redis/url',
            stringValue: `redis://${redisCluster.attrConfigurationEndPointAddress}:${redisCluster.attrConfigurationEndPointPort}`,
        });

        // パラメータにタグを追加
        cdk.Tags.of(databaseUrlParam).add('Name', `${props.projectName}-large-param-db`);
        cdk.Tags.of(redisUrlParam).add('Name', `${props.projectName}-large-param-redis`);

        // パラメータ情報の記録
        recorder.recordParameter(databaseUrlParam, this.stackName);
        recorder.recordParameter(redisUrlParam, this.stackName);

        // リソース情報をファイルに保存
        recorder.saveToFile();

        // 出力
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: apiService.loadBalancer.loadBalancerDnsName,
            description: 'API Load Balancer Endpoint',
        });

        new cdk.CfnOutput(this, 'FrontendEndpoint', {
            value: frontendService.loadBalancer.loadBalancerDnsName,
            description: 'Frontend Load Balancer Endpoint',
        });

        new cdk.CfnOutput(this, 'CloudFrontDomain', {
            value: distribution.distributionDomainName,
            description: 'CloudFront Distribution Domain Name',
        });
    }
}