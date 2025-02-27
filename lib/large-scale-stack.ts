import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as shield from 'aws-cdk-lib/aws-shield';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import { ResourceRecorder } from './utils/core/resource-recorder';
import { VpcBuilder } from './utils/builders/vpc-builder';
import { S3Builder } from './utils/builders/s3-builder';
import { CdnBuilder } from './utils/builders/cdn-builder';
import { EcsBuilder } from './utils/builders/ecs-builder';
import { WafBuilder } from './utils/builders/waf-builder';
import { DbBuilder } from './utils/builders/db-builder';
import { CacheBuilder } from './utils/builders/cache-builder';
import { CloudWatchSetup } from './utils/monitoring/cloudwatch-setup';

export interface LargeScaleStackProps extends cdk.StackProps {
    projectName: string;
    environment?: 'production' | 'staging' | 'development';
}

export class LargeScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: LargeScaleStackProps) {
        super(scope, id, props);

        const environment = props.environment || 'development';
        const recorder = new ResourceRecorder(props.projectName);

        // スタック全体にタグを追加
        cdk.Tags.of(this).add('Project', props.projectName);
        cdk.Tags.of(this).add('Environment', environment);
        cdk.Tags.of(this).add('CreatedBy', 'cdk');
        cdk.Tags.of(this).add('CreatedAt', new Date().toISOString().split('T')[0]);

        // VPCの作成（マルチAZ）
        const vpc = new VpcBuilder(this, {
            projectName: props.projectName,
            environment,
            maxAzs: 3,
            natGateways: 3,
            vpcName: `${props.projectName}-large-vpc`,
        }).build();
        recorder.recordVpc(vpc, this.stackName);

        // Aurora Global Databaseの作成
        const database = new DbBuilder(this, {
            projectName: props.projectName,
            environment,
            vpc,
            engine: 'aurora-postgresql',
            version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_15_2,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
            instances: 3,
            databaseName: 'application',
            backup: {
                retention: 30,
                preferredWindow: '03:00-04:00',
                deletionProtection: true,
            },
            maintenance: {
                preferredWindow: '04:00-05:00',
                autoMinorVersionUpgrade: true,
            },
            monitoring: {
                enablePerformanceInsights: true,
                enableEnhancedMonitoring: true,
                monitoringInterval: 60,
            },
            replication: {
                enableGlobalDatabase: true,
                regions: ['us-west-2'], // セカンダリリージョン
            },
        }).build();

        // DatabaseClusterの型チェック
        if (!(database instanceof cdk.aws_rds.DatabaseCluster)) {
            throw new Error('Expected Aurora Cluster but got DatabaseInstance');
        }
        const auroraCluster = database;
        recorder.recordRds(auroraCluster, this.stackName);

        // Redis Clusterの作成
        const redisCluster = new CacheBuilder(this, {
            projectName: props.projectName,
            environment,
            vpc,
            engine: 'redis',
            version: '6.x',
            nodeType: 'cache.r6g.large',
            multiAz: true,
            replication: {
                numNodeGroups: 3,
                replicasPerNodeGroup: 2,
            },
            maintenance: {
                preferredWindow: '03:00-04:00',
                autoMinorVersionUpgrade: true,
            },
            backup: {
                retention: 14,
                preferredWindow: '02:00-03:00',
            },
            parameterGroup: {
                family: 'redis6.x',
                parameters: {
                    'maxmemory-policy': 'volatile-lru',
                    'timeout': '300',
                },
            },
        }).build();
        recorder.recordElastiCache(redisCluster, this.stackName);

        // S3バケットの作成
        const staticAssetsBucket = new S3Builder(this, {
            projectName: props.projectName,
            environment,
            bucketName: `${props.projectName}-static-assets`,
            versioned: true,
            lifecycleRules: [{
                enabled: true,
                expiration: 365,
                transitions: [{
                    storageClass: 'INTELLIGENT_TIERING',
                    transitionAfter: 90,
                }],
            }],
        }).build();

        const cfLogsBucket = new S3Builder(this, {
            projectName: props.projectName,
            environment,
            bucketName: `${props.projectName}-cf-logs`,
        }).build();

        recorder.recordS3(staticAssetsBucket, this.stackName);
        recorder.recordS3(cfLogsBucket, this.stackName);

        // CloudFrontディストリビューションの作成
        const distribution = new CdnBuilder(this, {
            projectName: props.projectName,
            environment,
            s3Bucket: staticAssetsBucket,
            enableLogging: true,
            logRetentionDays: 90,
        }).build();

        if (distribution) {
            recorder.recordCloudFront(distribution, this.stackName);
        }

        // ECSクラスターとサービスの作成
        const ecsBuilder = new EcsBuilder(this, {
            projectName: props.projectName,
            environment,
            vpc,
            cpu: 2048,
            memoryLimitMiB: 4096,
            desiredCount: 10,
            minCapacity: 10,
            maxCapacity: 50,
            containerPort: 80,
            serviceConfig: {
                name: `${props.projectName}-large-api`,
                image: 'api-image:latest',
                environment: {
                    DATABASE_URL: auroraCluster.clusterEndpoint.socketAddress,
                    REDIS_URL: redisCluster instanceof cdk.aws_elasticache.CfnReplicationGroup
                        ? `redis://${redisCluster.attrConfigurationEndPointAddress}:${redisCluster.attrConfigurationEndPointPort}`
                        : `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
                },
            },
        });

        const ecsResources = ecsBuilder.build();
        const apiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'ApiService', {
            cluster: ecsResources.cluster,
            memoryLimitMiB: 4096,
            cpu: 2048,
            desiredCount: 10,
            taskImageOptions: {
                image: cdk.aws_ecs.ContainerImage.fromRegistry('api-image:latest'),
                environment: {
                    DATABASE_URL: auroraCluster.clusterEndpoint.socketAddress,
                    REDIS_URL: redisCluster instanceof cdk.aws_elasticache.CfnReplicationGroup
                        ? `redis://${redisCluster.attrConfigurationEndPointAddress}:${redisCluster.attrConfigurationEndPointPort}`
                        : `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
                },
            },
            publicLoadBalancer: true,
        });

        // WAF + Shield Advancedの設定
        const wafAcl = new WafBuilder(this, {
            projectName: props.projectName,
            environment,
            scope: 'CLOUDFRONT',
            rules: [
                {
                    name: 'AWSManagedRulesCommonRuleSet',
                    priority: 1,
                    action: 'allow',
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesCommonRuleSet',
                            vendorName: 'AWS',
                        },
                    },
                },
                {
                    name: 'RateLimit',
                    priority: 2,
                    action: 'block',
                    statement: {
                        rateBasedStatement: {
                            limit: 2000,
                            aggregateKeyType: 'IP',
                        },
                    },
                },
            ],
            defaultAction: 'allow',
        }).build();

        if (wafAcl) {
            recorder.recordWaf(wafAcl, this.stackName);
        }

        // Shield Advancedの保護
        if (distribution) {
            const shieldProtection = new shield.CfnProtection(this, 'ShieldProtection', {
                name: 'LargeScaleProtection',
                resourceArn: distribution.distributionArn,
            });
            recorder.recordShieldProtection(shieldProtection, this.stackName);
        }

        // CI/CDパイプラインの作成
        const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
            pipelineName: 'LargeScaleDeploymentPipeline',
        });

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

        recorder.recordCodePipeline(pipeline, this.stackName);

        // CloudWatchダッシュボードの作成
        const dashboard = new CloudWatchSetup(this, {
            projectName: props.projectName,
            environment,
            namespace: `${props.projectName}-metrics`,
            dashboardName: 'LargeScaleApplicationMetrics',
            alarms: [
                {
                    metricName: 'CPUUtilization',
                    threshold: 80,
                    evaluationPeriods: 3,
                },
                {
                    metricName: 'MemoryUtilization',
                    threshold: 80,
                    evaluationPeriods: 3,
                },
            ],
        }, {
            vpc,
            ecsService: apiService.service,
            database: auroraCluster,
            alb: apiService.loadBalancer,
        }).build();

        if (dashboard) {
            recorder.recordCloudWatchDashboard(dashboard, this.stackName);
        }

        // Systems Manager Parameter Storeの設定
        const databaseUrlParam = new ssm.StringParameter(this, 'DatabaseUrl', {
            parameterName: '/prod/database/url',
            stringValue: auroraCluster.clusterEndpoint.socketAddress,
        });

        const redisUrlParam = new ssm.StringParameter(this, 'RedisUrl', {
            parameterName: '/prod/redis/url',
            stringValue: redisCluster instanceof cdk.aws_elasticache.CfnReplicationGroup
                ? `redis://${redisCluster.attrConfigurationEndPointAddress}:${redisCluster.attrConfigurationEndPointPort}`
                : `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
        });

        recorder.recordParameter(databaseUrlParam, this.stackName);
        recorder.recordParameter(redisUrlParam, this.stackName);

        // リソース情報をファイルに保存
        recorder.saveToFile();

        // 出力の追加
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: apiService.loadBalancer.loadBalancerDnsName,
            description: 'API Load Balancer Endpoint',
        });

        if (distribution) {
            new cdk.CfnOutput(this, 'CloudFrontDomain', {
                value: distribution.distributionDomainName,
                description: 'CloudFront Distribution Domain Name',
            });
        }
    }
}