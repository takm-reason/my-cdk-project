import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { BaseResourceBuilder } from '../core/stack-builder';
import { DatabaseInstanceConfig, AuroraConfig } from '../interfaces/config';
import { ConfigValidator } from '../helpers/validators';

export class DbBuilder extends BaseResourceBuilder<rds.DatabaseInstance | rds.DatabaseCluster, DatabaseInstanceConfig | AuroraConfig> {
    validate(): boolean {
        return ConfigValidator.validateDatabaseConfig(this.config);
    }

    build(): rds.DatabaseInstance | rds.DatabaseCluster {
        if (this.config.engine === 'postgresql') {
            return this.createPostgresInstance(this.config as DatabaseInstanceConfig);
        } else {
            return this.createAuroraCluster(this.config as AuroraConfig);
        }
    }

    private createPostgresInstance(config: DatabaseInstanceConfig): rds.DatabaseInstance {
        const instance = new rds.DatabaseInstance(this.scope, this.generateName('db'), {
            engine: rds.DatabaseInstanceEngine.postgres({
                version: config.version,
            }),
            instanceType: config.instanceType,
            vpc: config.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            multiAz: config.multiAz,
            databaseName: config.databaseName,
            port: config.port || 5432,
            storageEncrypted: config.encrypted ?? true,
            allocatedStorage: config.storageConfig?.allocatedStorage || 20,
            maxAllocatedStorage: config.storageConfig?.maxAllocatedStorage,
            storageType: config.storageConfig?.storageType || rds.StorageType.GP3,
            iops: config.storageConfig?.iops,
            backupRetention: config.backup ? cdk.Duration.days(config.backup.retention) : cdk.Duration.days(7),
            preferredBackupWindow: config.backup?.preferredWindow,
            deletionProtection: config.backup?.deletionProtection,
            preferredMaintenanceWindow: config.maintenance?.preferredWindow,
            autoMinorVersionUpgrade: config.maintenance?.autoMinorVersionUpgrade ?? true,
            enablePerformanceInsights: config.monitoring?.enablePerformanceInsights,
            monitoringInterval: config.monitoring?.enableEnhancedMonitoring
                ? cdk.Duration.seconds(config.monitoring.monitoringInterval || 60)
                : cdk.Duration.seconds(0),
            cloudwatchLogsExports: ['postgresql', 'upgrade'],
            cloudwatchLogsRetention: logs.RetentionDays.THREE_MONTHS,
        });

        this.addTags(instance);
        return instance;
    }

    private createAuroraCluster(config: AuroraConfig): rds.DatabaseCluster {
        const engine = rds.DatabaseClusterEngine.auroraPostgres({
            version: config.version,
        });

        // クラスターの設定を構築
        const baseProps = {
            engine,
            instances: config.instances,
            backup: {
                retention: config.backup ? cdk.Duration.days(config.backup.retention) : cdk.Duration.days(7),
                preferredWindow: config.backup?.preferredWindow,
            },
            preferredMaintenanceWindow: config.maintenance?.preferredWindow,
            cloudwatchLogsRetention: logs.RetentionDays.THREE_MONTHS,
            cloudwatchLogsExports: ['postgresql'],
            storageEncrypted: true,
            deletionProtection: config.backup?.deletionProtection,
            monitoringInterval: config.monitoring?.enableEnhancedMonitoring
                ? cdk.Duration.seconds(config.monitoring.monitoringInterval || 60)
                : cdk.Duration.seconds(0),
            port: config.port || 5432,
            vpc: config.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
        };

        // Serverless V2の場合とそれ以外で異なる設定を適用
        const clusterProps: rds.DatabaseClusterProps = config.serverless
            ? {
                ...baseProps,
                serverlessV2MinCapacity: config.serverless.minCapacity,
                serverlessV2MaxCapacity: config.serverless.maxCapacity,
            }
            : {
                ...baseProps,
                instanceProps: {
                    instanceType: config.instanceType,
                    vpc: config.vpc,
                    vpcSubnets: {
                        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    },
                },
            };

        const cluster = new rds.DatabaseCluster(this.scope, this.generateName('aurora'), clusterProps);

        // グローバルデータベースの設定
        if (config.replication?.enableGlobalDatabase && config.replication.regions && cluster.clusterIdentifier) {
            const globalId = `${config.projectName}-global`;
            const cfnCluster = cluster.node.defaultChild as rds.CfnDBCluster;

            // プライマリクラスターをグローバルデータベースとして設定
            const globalCluster = new rds.CfnGlobalCluster(this.scope, this.generateName('global'), {
                globalClusterIdentifier: globalId,
                sourceDbClusterIdentifier: cluster.clusterIdentifier,
                engine: 'aurora-postgresql',
                engineVersion: cfnCluster.engineVersion || config.version.toString(),
                deletionProtection: config.backup?.deletionProtection,
            });

            // セカンダリリージョン情報をタグとして保存
            config.replication.regions.forEach((region, index) => {
                cdk.Tags.of(cluster).add(`SecondaryRegion${index}`, region);
            });

            cdk.Tags.of(cluster).add('GlobalClusterId', globalId);
        }

        this.addTags(cluster);
        return cluster;
    }

    createPostgresDatabase(props: DatabaseInstanceConfig): rds.DatabaseInstance {
        return this.createPostgresInstance(props);
    }

    createAuroraPostgresDatabase(props: AuroraConfig): rds.DatabaseCluster {
        return this.createAuroraCluster(props);
    }

    protected addTags(resource: cdk.IResource, additionalTags?: { [key: string]: string }): void {
        super.addTags(resource);
        if (additionalTags) {
            Object.entries(additionalTags).forEach(([key, value]) => {
                cdk.Tags.of(resource).add(key, value);
            });
        }
    }
}