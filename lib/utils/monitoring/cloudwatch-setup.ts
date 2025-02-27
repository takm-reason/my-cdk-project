import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { BaseResourceBuilder } from '../core/stack-builder';
import { MonitoringConfig } from '../interfaces/config';

interface MonitoredResources {
    vpc?: ec2.Vpc;
    database?: rds.DatabaseInstance | rds.DatabaseCluster;
    ecsService?: ecs.FargateService;
    alb?: elbv2.ApplicationLoadBalancer;
}

export class CloudWatchSetup extends BaseResourceBuilder<cloudwatch.Dashboard, MonitoringConfig> {
    private readonly resources: MonitoredResources;

    constructor(scope: cdk.Stack, config: MonitoringConfig, resources: MonitoredResources) {
        super(scope, config);
        this.resources = resources;
    }

    validate(): boolean {
        if (!this.config.namespace) {
            throw new Error('Namespace is required for monitoring setup');
        }
        return true;
    }

    build(): cloudwatch.Dashboard {
        // アラームの設定
        if (this.config.alarms) {
            this.createAlarms();
        }

        // ダッシュボードの作成
        return this.createDashboard();
    }

    private createAlarms(): void {
        if (this.resources.ecsService) {
            this.createEcsAlarms();
        }

        if (this.resources.database) {
            this.createDatabaseAlarms();
        }

        if (this.resources.alb) {
            this.createAlbAlarms();
        }
    }

    private createEcsAlarms(): void {
        const service = this.resources.ecsService!;

        // CPU使用率アラーム
        new cloudwatch.Alarm(this.scope, this.generateName('ecs-cpu-alarm'), {
            metric: service.metricCpuUtilization(),
            threshold: 85,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.BREACHING,
        });

        // メモリ使用率アラーム
        new cloudwatch.Alarm(this.scope, this.generateName('ecs-memory-alarm'), {
            metric: service.metricMemoryUtilization(),
            threshold: 85,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.BREACHING,
        });
    }

    private createDatabaseAlarms(): void {
        const db = this.resources.database!;

        // CPU使用率アラーム
        new cloudwatch.Alarm(this.scope, this.generateName('db-cpu-alarm'), {
            metric: db.metricCPUUtilization(),
            threshold: 80,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        });

        // フリーストレージスペースアラーム
        if (db instanceof rds.DatabaseInstance) {
            new cloudwatch.Alarm(this.scope, this.generateName('db-storage-alarm'), {
                metric: db.metric('FreeStorageSpace', {
                    statistic: 'Average',
                    period: cdk.Duration.minutes(5),
                }),
                threshold: 10000000000, // 10GB
                evaluationPeriods: 3,
                datapointsToAlarm: 2,
                comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            });
        }
    }

    private createAlbAlarms(): void {
        const alb = this.resources.alb!;

        // HTTPレイテンシーアラーム
        new cloudwatch.Alarm(this.scope, this.generateName('alb-latency-alarm'), {
            metric: alb.metricTargetResponseTime(),
            threshold: 5,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        });

        // 5XXエラーレートアラーム
        new cloudwatch.Alarm(this.scope, this.generateName('alb-5xx-alarm'), {
            metric: alb.metricHttpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT),
            threshold: 10,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        });
    }

    private createDashboard(): cloudwatch.Dashboard {
        const dashboard = new cloudwatch.Dashboard(this.scope, this.generateName('dashboard'), {
            dashboardName: this.config.dashboardName || `${this.config.projectName}-${this.config.environment}`,
        });

        // ECSメトリクス
        if (this.resources.ecsService) {
            dashboard.addWidgets(
                new cloudwatch.GraphWidget({
                    title: 'ECS Service Metrics',
                    left: [
                        this.resources.ecsService.metricCpuUtilization(),
                        this.resources.ecsService.metricMemoryUtilization(),
                    ],
                })
            );
        }

        // データベースメトリクス
        if (this.resources.database) {
            const dbMetrics = [
                this.resources.database.metricCPUUtilization(),
                this.resources.database.metricDatabaseConnections(),
            ];

            if (this.resources.database instanceof rds.DatabaseInstance) {
                dbMetrics.push(
                    this.resources.database.metric('FreeStorageSpace', {
                        statistic: 'Average',
                        period: cdk.Duration.minutes(5),
                    })
                );
            }

            dashboard.addWidgets(
                new cloudwatch.GraphWidget({
                    title: 'Database Metrics',
                    left: dbMetrics,
                })
            );
        }

        // ALBメトリクス
        if (this.resources.alb) {
            dashboard.addWidgets(
                new cloudwatch.GraphWidget({
                    title: 'ALB Metrics',
                    left: [
                        this.resources.alb.metricTargetResponseTime(),
                        this.resources.alb.metricHttpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT),
                        this.resources.alb.metricRequestCount(),
                    ],
                })
            );
        }

        this.addTags(dashboard);
        return dashboard;
    }
}