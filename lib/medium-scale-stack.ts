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
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { ResourceRecorder } from './utils/resource-recorder';

export interface MediumScaleStackProps extends cdk.StackProps {
    projectName: string;
}

export class MediumScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: MediumScaleStackProps) {
        super(scope, id, props);

        const recorder = new ResourceRecorder(props.projectName);

        // スタック全体にタグを追加
        cdk.Tags.of(this).add('project-name', props.projectName);
        cdk.Tags.of(this).add('Scale', 'medium');

        // VPCの作成（マルチAZ）
        const vpc = new ec2.Vpc(this, 'MediumScaleVPC', {
            maxAzs: 3,
            natGateways: 2,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 24,
                    name: 'Isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                }
            ],
        });

        // VPCにタグを追加
        cdk.Tags.of(vpc).add('Name', `${props.projectName}-medium-vpc`);

        // VPC情報の記録
        recorder.recordVpc(vpc, this.stackName);

        // Aurora Serverless v2の作成
        const auroraCluster = new rds.DatabaseCluster(this, 'AuroraServerlessV2', {
            engine: rds.DatabaseClusterEngine.auroraMysql({
                version: rds.AuroraMysqlEngineVersion.VER_3_03_0,
            }),
            instances: 2,
            instanceProps: {
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
                vpc,
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            },
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: 2,
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
        });

        // Auroraクラスターにタグを追加
        cdk.Tags.of(auroraCluster).add('Name', `${props.projectName}-medium-aurora`);

        // Aurora情報の記録
        recorder.recordRds(auroraCluster, this.stackName);

        // ElastiCache (Redis) の作成
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

        const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
            engine: 'redis',
            cacheNodeType: 'cache.t4g.medium',
            numCacheNodes: 1,
            vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
            cacheSubnetGroupName: redisSubnetGroup.ref,
        });

        // Redisクラスターにタグを追加
        cdk.Tags.of(redisCluster).add('Name', `${props.projectName}-medium-redis`);

        // Redis情報の記録
        recorder.recordElastiCache(redisCluster, this.stackName);

        // S3バケットの作成
        const staticAssetsBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
            versioned: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            lifecycleRules: [
                {
                    expiration: cdk.Duration.days(365),
                    noncurrentVersionExpiration: cdk.Duration.days(30),
                },
            ],
        });

        // S3バケットにタグを追加
        cdk.Tags.of(staticAssetsBucket).add('Name', `${props.projectName}-medium-static-assets`);

        // S3情報の記録
        recorder.recordS3(staticAssetsBucket, this.stackName);

        // CloudFrontディストリビューションの作成
        const distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
            defaultBehavior: {
                origin: new origins.S3Origin(staticAssetsBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
        });

        // CloudFrontにタグを追加
        cdk.Tags.of(distribution).add('Name', `${props.projectName}-medium-cf`);

        // CloudFront情報の記録
        recorder.recordCloudFront(distribution, this.stackName);

        // ECSクラスターの作成
        const cluster = new ecs.Cluster(this, 'MediumScaleCluster', {
            vpc,
            containerInsights: true,
        });

        // ECSクラスターにタグを追加
        cdk.Tags.of(cluster).add('Name', `${props.projectName}-medium-cluster`);

        // WAFの作成
        const wafAcl = new wafv2.CfnWebACL(this, 'WAFWebACL', {
            defaultAction: { allow: {} },
            scope: 'REGIONAL',
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
            ],
        });

        // WAFにタグを追加
        cdk.Tags.of(wafAcl).add('Name', `${props.projectName}-medium-waf`);

        // WAF情報の記録
        recorder.recordWaf(wafAcl, this.stackName);

        // ALBとFargateサービスの作成
        const loadBalancedFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MediumScaleService', {
            cluster,
            memoryLimitMiB: 2048,
            cpu: 1024,
            desiredCount: 2,
            publicLoadBalancer: true,
            assignPublicIp: false,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'),
                environment: {
                    DATABASE_URL: auroraCluster.clusterEndpoint.socketAddress,
                    REDIS_URL: `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
                    S3_BUCKET: staticAssetsBucket.bucketName,
                    CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
                },
            },
        });

        // Fargateサービスにタグを追加
        cdk.Tags.of(loadBalancedFargateService.service).add('Name', `${props.projectName}-medium-service`);
        cdk.Tags.of(loadBalancedFargateService.loadBalancer).add('Name', `${props.projectName}-medium-alb`);

        // ECS情報の記録
        recorder.recordEcs(cluster, loadBalancedFargateService, this.stackName);

        // Auto Scalingの設定
        const scaling = loadBalancedFargateService.service.autoScaleTaskCount({
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

        // セキュリティグループの設定
        const ecsSecurityGroup = loadBalancedFargateService.service.connections.securityGroups[0];
        redisSecurityGroup.addIngressRule(
            ecsSecurityGroup,
            ec2.Port.tcp(6379),
            'Allow access from ECS tasks'
        );

        // WAFをALBに関連付け
        new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
            resourceArn: loadBalancedFargateService.loadBalancer.loadBalancerArn,
            webAclArn: wafAcl.attrArn,
        });

        // リソース情報をファイルに保存
        recorder.saveToFile();

        // 出力
        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: loadBalancedFargateService.loadBalancer.loadBalancerDnsName,
            description: 'Application Load Balancer DNS Name',
        });

        new cdk.CfnOutput(this, 'CloudFrontDomain', {
            value: distribution.distributionDomainName,
            description: 'CloudFront Distribution Domain Name',
        });

        new cdk.CfnOutput(this, 'S3BucketName', {
            value: staticAssetsBucket.bucketName,
            description: 'Static Assets S3 Bucket Name',
        });
    }
}