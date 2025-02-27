import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import { BaseResourceBuilder } from '../core/stack-builder';
import { EcsServiceConfig } from '../interfaces/config';
import { ConfigValidator } from '../helpers/validators';

interface EcsResources {
    cluster: ecs.Cluster;
    service: ecs.FargateService;
    alb: elbv2.ApplicationLoadBalancer;
    targetGroup: elbv2.ApplicationTargetGroup;
}

export class EcsBuilder extends BaseResourceBuilder<EcsResources, EcsServiceConfig> {
    validate(): boolean {
        return ConfigValidator.validateEcsConfig(this.config);
    }

    build(): EcsResources {
        // クラスターの作成
        const cluster = this.createCluster();

        // タスク定義の作成
        const taskDefinition = this.createTaskDefinition();

        // ALBの作成
        const alb = this.createLoadBalancer();

        // ターゲットグループの作成
        const targetGroup = this.createTargetGroup();

        // サービスの作成
        const service = this.createService(cluster, taskDefinition, targetGroup);

        // ALBリスナーの設定
        this.configureAlbListener(alb, targetGroup);

        // スケーリングの設定
        this.configureAutoScaling(service);

        return {
            cluster,
            service,
            alb,
            targetGroup
        };
    }

    private createCluster(): ecs.Cluster {
        const cluster = new ecs.Cluster(this.scope, this.generateName('cluster'), {
            vpc: this.config.vpc,
            containerInsights: true,
        });

        this.addTags(cluster);
        return cluster;
    }

    private createTaskDefinition(): ecs.FargateTaskDefinition {
        const taskDefinition = new ecs.FargateTaskDefinition(this.scope, this.generateName('task'), {
            cpu: this.config.cpu,
            memoryLimitMiB: this.config.memoryLimitMiB,
        });

        // CloudWatch Logsの設定
        const logGroup = new logs.LogGroup(this.scope, this.generateName('logs'), {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        // コンテナの追加
        const container = taskDefinition.addContainer(this.generateName('container'), {
            image: ecs.ContainerImage.fromRegistry(this.config.serviceConfig.image),
            environment: this.config.serviceConfig.environment || {},
            logging: ecs.LogDrivers.awsLogs({
                logGroup,
                streamPrefix: this.config.serviceConfig.name
            }),
            healthCheck: {
                command: ['CMD-SHELL', 'curl -f http://localhost:${this.config.containerPort}/health || exit 1'],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                retries: 3,
                startPeriod: cdk.Duration.seconds(60)
            }
        });

        container.addPortMappings({
            containerPort: this.config.containerPort,
            protocol: ecs.Protocol.TCP
        });

        this.addTags(taskDefinition);
        return taskDefinition;
    }

    private createLoadBalancer(): elbv2.ApplicationLoadBalancer {
        const alb = new elbv2.ApplicationLoadBalancer(this.scope, this.generateName('alb'), {
            vpc: this.config.vpc,
            internetFacing: true
        });

        this.addTags(alb);
        return alb;
    }

    private createTargetGroup(): elbv2.ApplicationTargetGroup {
        const targetGroup = new elbv2.ApplicationTargetGroup(this.scope, this.generateName('tg'), {
            vpc: this.config.vpc,
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: this.config.containerPort,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                path: '/health',
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 5
            }
        });

        return targetGroup;
    }

    private configureAlbListener(
        alb: elbv2.ApplicationLoadBalancer,
        targetGroup: elbv2.ApplicationTargetGroup
    ): void {
        const listener = alb.addListener('Listener', {
            port: 80,
            defaultTargetGroups: [targetGroup]
        });

        this.addTags(listener);
    }

    private createService(
        cluster: ecs.Cluster,
        taskDefinition: ecs.FargateTaskDefinition,
        targetGroup: elbv2.ApplicationTargetGroup
    ): ecs.FargateService {
        // セキュリティグループの作成
        const serviceSecurityGroup = new ec2.SecurityGroup(this.scope, this.generateName('service-sg'), {
            vpc: this.config.vpc,
            description: 'Security group for ECS service'
        });

        const service = new ecs.FargateService(this.scope, this.generateName('service'), {
            cluster,
            taskDefinition,
            desiredCount: this.config.desiredCount,
            securityGroups: [serviceSecurityGroup],
            assignPublicIp: false,
            healthCheckGracePeriod: cdk.Duration.seconds(60),
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            }
        });

        service.attachToApplicationTargetGroup(targetGroup);

        this.addTags(service);
        this.addTags(serviceSecurityGroup);

        return service;
    }

    private configureAutoScaling(service: ecs.FargateService): void {
        const scaling = service.autoScaleTaskCount({
            minCapacity: this.config.minCapacity,
            maxCapacity: this.config.maxCapacity
        });

        // CPU使用率によるスケーリング
        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60)
        });

        // メモリ使用率によるスケーリング
        scaling.scaleOnMemoryUtilization('MemoryScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60)
        });
    }
}