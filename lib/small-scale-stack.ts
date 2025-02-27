import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import { ResourceRecorder } from './utils/core/resource-recorder';
import { VpcBuilder } from './utils/builders/vpc-builder';
import { S3Builder } from './utils/builders/s3-builder';
import { DbBuilder } from './utils/builders/db-builder';
import { CacheBuilder } from './utils/builders/cache-builder';
import { EcsBuilder } from './utils/builders/ecs-builder';
import { CloudWatchSetup } from './utils/monitoring/cloudwatch-setup';

export interface SmallScaleStackProps extends cdk.StackProps {
    projectName: string;
    environment?: 'production' | 'staging' | 'development';
}

export class SmallScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: SmallScaleStackProps) {
        super(scope, id, props);

        const environment = props.environment || 'development';
        const recorder = new ResourceRecorder(props.projectName);

        // スタック全体にタグを追加
        cdk.Tags.of(this).add('Project', props.projectName);
        cdk.Tags.of(this).add('Environment', environment);
        cdk.Tags.of(this).add('CreatedBy', 'cdk');
        cdk.Tags.of(this).add('CreatedAt', new Date().toISOString().split('T')[0]);

        // VPCの作成
        const vpc = new VpcBuilder(this, {
            projectName: props.projectName,
            environment,
            maxAzs: 2,
            natGateways: 1,
            vpcName: `${props.projectName}-small-vpc`,
        }).build();
        recorder.recordVpc(vpc, this.stackName);

        // RDSの作成（Single-AZ）
        const database = new DbBuilder(this, {
            projectName: props.projectName,
            environment,
            vpc,
            engine: 'postgresql',
            version: cdk.aws_rds.PostgresEngineVersion.VER_15,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
            multiAz: false,
            databaseName: 'application',
            storageConfig: {
                allocatedStorage: 20,
                maxAllocatedStorage: 100,
            },
            backup: {
                retention: 7,
                preferredWindow: '03:00-04:00',
                deletionProtection: false,
            },
            maintenance: {
                preferredWindow: '04:00-05:00',
                autoMinorVersionUpgrade: true,
            },
            monitoring: {
                enablePerformanceInsights: true,
                monitoringInterval: 60,
            },
        }).build();

        // DatabaseInstanceの型チェック
        if (!(database instanceof cdk.aws_rds.DatabaseInstance)) {
            throw new Error('Expected DatabaseInstance but got DatabaseCluster');
        }
        const databaseInstance = database;
        recorder.recordRds(databaseInstance, this.stackName);

        // Redisの作成（Single Node）
        const redisCache = new CacheBuilder(this, {
            projectName: props.projectName,
            environment,
            vpc,
            engine: 'redis',
            version: '6.x',
            nodeType: 'cache.t4g.micro',
            multiAz: false,
            maintenance: {
                preferredWindow: '03:00-04:00',
                autoMinorVersionUpgrade: true,
            },
            parameterGroup: {
                family: 'redis6.x',
                parameters: {
                    'maxmemory-policy': 'allkeys-lru',
                },
            },
        }).build();
        recorder.recordElastiCache(redisCache, this.stackName);

        // S3バケットの作成（静的ファイル用）
        const staticFilesBucket = new S3Builder(this, {
            projectName: props.projectName,
            environment,
            bucketName: `${props.projectName}-small-static-files`,
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
        recorder.recordS3(staticFilesBucket, this.stackName);

        // ECSクラスターとサービスの作成
        const ecsBuilder = new EcsBuilder(this, {
            projectName: props.projectName,
            environment,
            vpc,
            cpu: 512,
            memoryLimitMiB: 1024,
            desiredCount: 1,
            minCapacity: 1,
            maxCapacity: 2,
            containerPort: 80,
            serviceConfig: {
                name: `${props.projectName}-small-service`,
                image: 'nginx:latest',
                environment: {
                    DATABASE_URL: `postgresql://${databaseInstance.instanceEndpoint.hostname}:5432/app`,
                    REDIS_URL: redisCache instanceof cdk.aws_elasticache.CfnReplicationGroup
                        ? `redis://${redisCache.attrConfigurationEndPointAddress}:${redisCache.attrConfigurationEndPointPort}`
                        : `redis://${redisCache.attrRedisEndpointAddress}:${redisCache.attrRedisEndpointPort}`,
                    S3_BUCKET: staticFilesBucket.bucketName,
                },
            },
        });

        const ecsResources = ecsBuilder.build();
        const webService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'WebService', {
            cluster: ecsResources.cluster,
            memoryLimitMiB: 1024,
            cpu: 512,
            desiredCount: 1,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'),
                environment: {
                    DATABASE_URL: `postgresql://${databaseInstance.instanceEndpoint.hostname}:5432/app`,
                    REDIS_URL: redisCache instanceof cdk.aws_elasticache.CfnReplicationGroup
                        ? `redis://${redisCache.attrConfigurationEndPointAddress}:${redisCache.attrConfigurationEndPointPort}`
                        : `redis://${redisCache.attrRedisEndpointAddress}:${redisCache.attrRedisEndpointPort}`,
                    S3_BUCKET: staticFilesBucket.bucketName,
                },
            },
            publicLoadBalancer: true,
        });

        // Auto Scalingの設定
        const scaling = webService.service.autoScaleTaskCount({
            maxCapacity: 2,
            minCapacity: 1,
        });

        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 75,
            scaleInCooldown: cdk.Duration.seconds(300),
            scaleOutCooldown: cdk.Duration.seconds(300),
        });

        // CloudWatchダッシュボードの作成
        const dashboard = new CloudWatchSetup(this, {
            projectName: props.projectName,
            environment,
            namespace: `${props.projectName}-metrics`,
            dashboardName: 'SmallScaleApplicationMetrics',
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
            database: databaseInstance,
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

        new cdk.CfnOutput(this, 'S3BucketName', {
            value: staticFilesBucket.bucketName,
            description: 'Static Files S3 Bucket Name',
        });
    }
}