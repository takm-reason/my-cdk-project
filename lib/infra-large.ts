import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
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
    }
}