import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { IBuilder } from '../interfaces/builders';

export interface AlarmMetricConfig {
    namespace: string;
    metricName: string;
    dimensions?: { [key: string]: string };
    statistic?: string;
    period?: cdk.Duration;
    threshold?: number;
    evaluationPeriods?: number;
    comparisonOperator?: cloudwatch.ComparisonOperator;
    treatMissingData?: cloudwatch.TreatMissingData;
}

export interface AlarmBuilderProps {
    scope: Construct;
    stackName: string;
    alarmNamePrefix: string;
    notificationTopic?: sns.ITopic;
    metrics: {
        [key: string]: AlarmMetricConfig;
    };
}

export class AlarmBuilder implements IBuilder<cloudwatch.Alarm[]> {
    private readonly props: AlarmBuilderProps;
    private readonly alarms: cloudwatch.Alarm[] = [];

    constructor(props: AlarmBuilderProps) {
        this.props = props;
    }

    private createDefaultMetricAlarms(): void {
        Object.entries(this.defaultMetrics).forEach(([name, config]) => {
            if (!this.props.metrics[name]) {
                this.props.metrics[name] = config;
            }
        });
    }

    private readonly defaultMetrics: { [key: string]: AlarmMetricConfig } = {
        cpuUtilization: {
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            threshold: 80,
            evaluationPeriods: 3,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.MISSING,
        },
        memoryUtilization: {
            namespace: 'AWS/ECS',
            metricName: 'MemoryUtilization',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            threshold: 80,
            evaluationPeriods: 3,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.MISSING,
        },
        databaseConnections: {
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            threshold: 100,
            evaluationPeriods: 3,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.MISSING,
        },
        freeStorageSpace: {
            namespace: 'AWS/RDS',
            metricName: 'FreeStorageSpace',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            threshold: 10 * 1024 * 1024 * 1024, // 10GB
            evaluationPeriods: 3,
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.MISSING,
        },
    };

    public build(): cloudwatch.Alarm[] {
        // デフォルトメトリクスの追加
        this.createDefaultMetricAlarms();

        // 各メトリクスに対してアラームを作成
        Object.entries(this.props.metrics).forEach(([name, config]) => {
            const metric = new cloudwatch.Metric({
                namespace: config.namespace,
                metricName: config.metricName,
                dimensionsMap: config.dimensions,
                statistic: config.statistic || 'Average',
                period: config.period || cdk.Duration.minutes(5),
            });

            const alarm = new cloudwatch.Alarm(this.props.scope, `${name}Alarm`, {
                alarmName: `${this.props.alarmNamePrefix}-${name}`,
                metric,
                threshold: config.threshold || 0,
                evaluationPeriods: config.evaluationPeriods || 3,
                comparisonOperator:
                    config.comparisonOperator ||
                    cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData:
                    config.treatMissingData || cloudwatch.TreatMissingData.MISSING,
            });

            // 通知トピックが設定されている場合はアラームアクションを追加
            if (this.props.notificationTopic) {
                alarm.addAlarmAction(new actions.SnsAction(this.props.notificationTopic));
            }

            // タグの設定
            cdk.Tags.of(alarm).add('Name', `${this.props.stackName}-${name}-alarm`);
            cdk.Tags.of(alarm).add('Service', 'CloudWatch');

            this.alarms.push(alarm);
        });

        return this.alarms;
    }

    public getAlarms(): cloudwatch.Alarm[] {
        return this.alarms;
    }
}