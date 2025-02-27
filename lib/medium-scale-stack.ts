import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { ResourceRecorder } from './utils/core/resource-recorder';
import { VpcBuilder } from './utils/builders/vpc-builder';
import { S3Builder } from './utils/builders/s3-builder';
import { CdnBuilder } from './utils/builders/cdn-builder';
import { EcsBuilder } from './utils/builders/ecs-builder';
import { WafBuilder } from './utils/builders/waf-builder';
import { DbBuilder } from './utils/builders/db-builder';
import { CacheBuilder } from './utils/builders/cache-builder';
import { CloudWatchSetup } from './utils/monitoring/cloudwatch-setup';

export interface MediumScaleStackProps extends cdk.StackProps {
    projectName: string;
    environment?: 'production' | 'staging' | 'development';
}

export class MediumScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: MediumScaleStackProps) {
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
            natGateways: 2,
            vpcName: `${props.projectName}-medium-vpc`,
        }).build();
        recorder.recordVpc(vpc, this.stackName);

        // Aurora Serverless v2の作成
        const database = new DbBuilder(this, {
            projectName: props.projectName,
            environment,
            vpc,
            engine: 'aurora-postgresql',
            version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_15_2,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
            instances: 2,
            databaseName: 'application',
            serverless: {
                minCapacity: 0.5,
                maxCapacity: 2,
                autoPause: true,
                secondsUntilAutoPause: 1800,
            },
            backup: {
                retention: 14,
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
            nodeType: 'cache.t4g.medium',
            multiAz: false,
            maintenance: {
                preferredWindow: '03:00-04:00',
                autoMinorVersionUpgrade: true,
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
            bucketName: `${props.projectName}-medium-static-assets`,
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
        recorder.recordS3(staticAssetsBucket, this.stackName);

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
            cpu: 1024,
            memoryLimitMiB: 2048,
            desiredCount: 2,
            minCapacity: 2,
            maxCapacity: 5,
            containerPort: 80,
            serviceConfig: {
                name: `${props.projectName}-medium-service`,
                image: 'nginx:latest',
                environment: {
                    DATABASE_URL: auroraCluster.clusterEndpoint.socketAddress,
                    REDIS_URL: redisCluster instanceof cdk.aws_elasticache.CfnReplicationGroup
                        ? `redis://${redisCluster.attrConfigurationEndPointAddress}:${redisCluster.attrConfigurationEndPointPort}`
                        : `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
                    S3_BUCKET: staticAssetsBucket.bucketName,
                    CLOUDFRONT_DOMAIN: distribution?.distributionDomainName,
                },
            },
        });

        const ecsResources = ecsBuilder.build();
        const webService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'WebService', {
            cluster: ecsResources.cluster,
            memoryLimitMiB: 2048,
            cpu: 1024,
            desiredCount: 2,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'),
                environment: {
                    DATABASE_URL: auroraCluster.clusterEndpoint.socketAddress,
                    REDIS_URL: redisCluster instanceof cdk.aws_elasticache.CfnReplicationGroup
                        ? `redis://${redisCluster.attrConfigurationEndPointAddress}:${redisCluster.attrConfigurationEndPointPort}`
                        : `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
                    S3_BUCKET: staticAssetsBucket.bucketName,
                    CLOUDFRONT_DOMAIN: distribution?.distributionDomainName,
                },
            },
            publicLoadBalancer: true,
        });

        // WAFの作成
        const wafAcl = new WafBuilder(this, {
            projectName: props.projectName,
            environment,
            scope: 'REGIONAL',
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
            ],
            defaultAction: 'allow',
        }).build();

        if (wafAcl) {
            recorder.recordWaf(wafAcl, this.stackName);

            // WAFをALBに関連付け
            new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
                resourceArn: webService.loadBalancer.loadBalancerArn,
                webAclArn: wafAcl.attrArn,
            });
        }

        // Auto Scalingの設定
        const scaling = webService.service.autoScaleTaskCount({
            maxCapacity: 5,
            minCapacity: 2,
        });

        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });

        scaling.scaleOnMemoryUtilization('MemoryScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });

        // CloudWatchダッシュボードの作成
        const dashboard = new CloudWatchSetup(this, {
            projectName: props.projectName,
            environment,
            namespace: `${props.projectName}-metrics`,
            dashboardName: 'MediumScaleApplicationMetrics',
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
            ecsService: webService.service,
            database: auroraCluster,
            alb: webService.loadBalancer,
        }).build();

        if (dashboard) {
            recorder.recordCloudWatchDashboard(dashboard, this.stackName);
        }

        // ECS情報の記録
        recorder.recordEcs(ecsResources.cluster, webService, this.stackName);

        // リソース情報をファイルに保存
        recorder.saveToFile();

        // 出力
        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: webService.loadBalancer.loadBalancerDnsName,
            description: 'Application Load Balancer DNS Name',
        });

        if (distribution) {
            new cdk.CfnOutput(this, 'CloudFrontDomain', {
                value: distribution.distributionDomainName,
                description: 'CloudFront Distribution Domain Name',
            });
        }

        new cdk.CfnOutput(this, 'S3BucketName', {
            value: staticAssetsBucket.bucketName,
            description: 'Static Assets S3 Bucket Name',
        });
    }
}