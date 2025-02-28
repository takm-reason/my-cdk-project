import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class InfraMediumStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Medium環境用のVPC設定
        const vpc = new ec2.Vpc(this, 'MediumVPC', {
            maxAzs: 2,
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

        // Medium環境用のAurora Serverless v2
        const database = new rds.DatabaseCluster(this, 'MediumDatabase', {
            engine: rds.DatabaseClusterEngine.auroraMysql({
                version: rds.AuroraMysqlEngineVersion.VER_3_04_0
            }),
            instanceProps: {
                vpc,
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED
                }
            },
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: 4,
            writer: rds.ClusterInstance.serverlessV2('writer'),
            readers: [
                rds.ClusterInstance.serverlessV2('reader1'),
            ],
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED
            },
            defaultDatabaseName: 'appdb',
        });

        // ECS Fargateクラスター
        const cluster = new ecs.Cluster(this, 'MediumCluster', {
            vpc,
            enableFargateCapacityProviders: true,
        });

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MediumService', {
            cluster,
            cpu: 512,
            memoryLimitMiB: 1024,
            desiredCount: 2,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'), // デモ用のイメージ
                containerPort: 80,
                environment: {
                    DATABASE_HOST: database.clusterEndpoint.hostname,
                    DATABASE_PORT: database.clusterEndpoint.port.toString(),
                    DATABASE_NAME: 'appdb',
                },
            },
            publicLoadBalancer: true,
        });

        // ECSサービスのAuto Scaling設定
        const scaling = fargateService.service.autoScaleTaskCount({
            minCapacity: 2,
            maxCapacity: 8,
        });

        // CPU使用率に基づくスケーリング
        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60),
        });

        // リクエスト数に基づくスケーリング
        scaling.scaleOnRequestCount('RequestScaling', {
            requestsPerTarget: 1000,
            targetGroup: fargateService.targetGroup,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60),
        });

        // RDSへのアクセスを許可
        database.connections.allowFrom(
            fargateService.service,
            ec2.Port.tcp(3306),
            'Allow from Fargate service'
        );
    }
}