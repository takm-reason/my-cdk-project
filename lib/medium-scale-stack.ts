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

export class MediumScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

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

        // CloudFrontディストリビューションの作成
        const distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
            defaultBehavior: {
                origin: new origins.S3Origin(staticAssetsBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
        });

        // ECSクラスターの作成
        const cluster = new ecs.Cluster(this, 'MediumScaleCluster', {
            vpc,
            containerInsights: true,
        });

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

        // ALBとFargateサービスの作成
        const loadBalancedFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MediumScaleService', {
            cluster,
            memoryLimitMiB: 2048,
            cpu: 1024,
            desiredCount: 2,
            publicLoadBalancer: true,
            assignPublicIp: false,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'), // 実際のアプリケーションイメージに置き換える
                environment: {
                    DATABASE_URL: auroraCluster.clusterEndpoint.socketAddress,
                    REDIS_URL: `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
                    S3_BUCKET: staticAssetsBucket.bucketName,
                    CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
                },
            },
        });

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
        const cfnWebACLAssociation = new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
            resourceArn: loadBalancedFargateService.loadBalancer.loadBalancerArn,
            webAclArn: wafAcl.attrArn,
        });

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