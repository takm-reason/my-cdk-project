import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class InfraSmallStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // プロジェクト名と環境名を取得
        const projectName = this.node.tryGetContext('projectName') || 'MyProject';
        const environment = 'small';

        // ランダムなサフィックスを生成（8文字）
        const suffix = Math.random().toString(36).substring(2, 10);

        // S3バケットの作成
        const bucket = new s3.Bucket(this, 'StorageBucket', {
            bucketName: `${projectName.toLowerCase()}-${environment}-${suffix}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.RETAIN,
            lifecycleRules: [
                {
                    expiration: cdk.Duration.days(365),
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        },
                        {
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(90),
                        }
                    ]
                }
            ]
        });

        // Small環境用のVPC設定
        const vpc = new ec2.Vpc(this, 'SmallVPC', {
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
                }
            ]
        });

        // Small環境用のRDSインスタンス
        const database = new rds.DatabaseInstance(this, 'SmallDatabase', {
            engine: rds.DatabaseInstanceEngine.mysql({
                version: rds.MysqlEngineVersion.VER_8_0
            }),
            vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
            allocatedStorage: 20,
            maxAllocatedStorage: 30,
            databaseName: 'appdb',
            multiAz: false,
            deletionProtection: false,
            backupRetention: cdk.Duration.days(7),
        });

        // ECS Fargateクラスター
        const cluster = new ecs.Cluster(this, 'SmallCluster', {
            vpc,
            enableFargateCapacityProviders: true,
        });

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'SmallService', {
            cluster,
            cpu: 256,
            memoryLimitMiB: 512,
            desiredCount: 1,
            taskImageOptions: {
                image: ecs.ContainerImage.fromRegistry('nginx:latest'), // デモ用のイメージ
                containerPort: 80,
                environment: {
                    // データベース接続情報など
                    DATABASE_HOST: database.instanceEndpoint.hostname,
                    DATABASE_PORT: database.instanceEndpoint.port.toString(),
                    DATABASE_NAME: 'appdb',
                },
            },
            publicLoadBalancer: true,
        });

        // RDSへのアクセスを許可
        database.connections.allowFrom(
            fargateService.service,
            ec2.Port.tcp(3306),
            'Allow from Fargate service'
        );
    }
}