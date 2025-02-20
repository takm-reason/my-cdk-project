import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as elasticloadbalancingv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class SmallScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // VPCの作成
        const vpc = new ec2.Vpc(this, 'SmallScaleVPC', {
            maxAzs: 2,
            natGateways: 1,
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
                }
            ],
        });

        // RDSの作成（Single-AZ）
        const databaseInstance = new rds.DatabaseInstance(this, 'SmallScaleDB', {
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_15,
            }),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
            multiAz: false,
            allocatedStorage: 20,
            maxAllocatedStorage: 100,
            deleteAutomatedBackups: true,
            backupRetention: cdk.Duration.days(7),
        });

        // S3バケットの作成（静的ファイル用）
        const staticFilesBucket = new s3.Bucket(this, 'StaticFilesBucket', {
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

        // ECSクラスターの作成
        const cluster = new ecs.Cluster(this, 'SmallScaleCluster', {
            vpc,
            containerInsights: true,
        });

        // ALBとFargateサービスの作成
        const loadBalancedFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'SmallScaleService', {
            cluster,
            memoryLimitMiB: 1024,
            cpu: 512,
            desiredCount: 1,
            publicLoadBalancer: true,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'), // 実際のアプリケーションイメージに置き換える
                environment: {
                    DATABASE_URL: `postgresql://${databaseInstance.instanceEndpoint.hostname}:5432/app`,
                    S3_BUCKET: staticFilesBucket.bucketName,
                },
            },
            assignPublicIp: false,
        });

        // Auto Scalingの設定（軽めの設定）
        const scaling = loadBalancedFargateService.service.autoScaleTaskCount({
            maxCapacity: 2,
            minCapacity: 1,
        });

        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 75,
            scaleInCooldown: cdk.Duration.seconds(300),
            scaleOutCooldown: cdk.Duration.seconds(300),
        });

        // セキュリティグループの設定
        databaseInstance.connections.allowFrom(
            loadBalancedFargateService.service,
            ec2.Port.tcp(5432),
            'Allow access from Fargate service'
        );

        // 出力
        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: loadBalancedFargateService.loadBalancer.loadBalancerDnsName,
            description: 'Application Load Balancer DNS Name',
        });

        new cdk.CfnOutput(this, 'S3BucketName', {
            value: staticFilesBucket.bucketName,
            description: 'Static Files S3 Bucket Name',
        });
    }
}