import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { InfrastructureStack, InfraBaseStackProps } from './infra-base-stack';

export class InfraDevStack extends InfrastructureStack {
    constructor(scope: Construct, id: string, props: InfraBaseStackProps) {
        super(scope, id, props);

        // S3バケットの作成（開発環境用）
        const bucket = new s3.Bucket(this, 'DevStorageBucket', {
            bucketName: `${this.projectPrefix.toLowerCase()}-${this.envName}-${this.resourceSuffix}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: false, // 開発環境なのでバージョニング無効
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true, // 開発環境なので削除を簡単に
        });

        // 開発環境用のVPC設定（シングルAZ、NATなし）
        const vpc = new ec2.Vpc(this, 'DevVPC', {
            maxAzs: 1,
            natGateways: 0,
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

        // 開発環境用のRDSインスタンス
        const database = new rds.DatabaseInstance(this, 'DevDatabase', {
            engine: rds.DatabaseInstanceEngine.mysql({
                version: rds.MysqlEngineVersion.VER_8_0
            }),
            vpc,
            credentials: rds.Credentials.fromSecret(this.databaseSecret),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
            allocatedStorage: 20,
            maxAllocatedStorage: 30,
            databaseName: 'appdb',
            multiAz: false,
            deletionProtection: false,
            removalPolicy: RemovalPolicy.DESTROY,
            backupRetention: cdk.Duration.days(1),
            publiclyAccessible: false,
        });

        // ECS Fargateクラスター
        const cluster = new ecs.Cluster(this, 'DevCluster', {
            vpc,
            enableFargateCapacityProviders: true,
        });

        // タスク定義の作成
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'DevTaskDef', {
            cpu: 256,
            memoryLimitMiB: 512,
        });

        const container = taskDefinition.addContainer('AppContainer', {
            image: ecs.ContainerImage.fromRegistry('nginx:latest'),
            secrets: {
                DATABASE_USERNAME: ecs.Secret.fromSecretsManager(this.databaseSecret, 'username'),
                DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(this.databaseSecret, 'password'),
            },
            environment: {
                DATABASE_HOST: database.instanceEndpoint.hostname,
                DATABASE_PORT: database.instanceEndpoint.port.toString(),
                DATABASE_NAME: 'appdb',
                RAILS_ENV: 'development',
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'dev-service',
            }),
        });

        container.addPortMappings({
            containerPort: 80,
            protocol: ecs.Protocol.TCP,
        });

        // ALBとECS Fargateサービスの統合
        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'DevService', {
            cluster,
            taskDefinition,
            publicLoadBalancer: true,
            desiredCount: 1,
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
        });

        // RDSへのアクセスを許可
        database.connections.allowFrom(
            fargateService.service,
            ec2.Port.tcp(3306),
            'Allow from Fargate service'
        );

        // CDK Outputs
        new cdk.CfnOutput(this, 'VpcId', {
            value: vpc.vpcId,
            description: 'VPC ID',
            exportName: `${this.projectPrefix}-${this.envName}-vpc-id`,
        });

        new cdk.CfnOutput(this, 'DatabaseEndpoint', {
            value: database.instanceEndpoint.hostname,
            description: 'Database endpoint',
            exportName: `${this.projectPrefix}-${this.envName}-db-endpoint`,
        });

        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: fargateService.loadBalancer.loadBalancerDnsName,
            description: 'Application Load Balancer DNS',
            exportName: `${this.projectPrefix}-${this.envName}-alb-dns`,
        });

        new cdk.CfnOutput(this, 'BucketName', {
            value: bucket.bucketName,
            description: 'S3 Bucket Name',
            exportName: `${this.projectPrefix}-${this.envName}-bucket-name`,
        });
    }
}