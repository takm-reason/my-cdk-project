import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cdk from 'aws-cdk-lib';
import { BaseResourceBuilder } from '../core/stack-builder';
import { DatabaseConfig } from '../interfaces/config';
import { ConfigValidator } from '../helpers/validators';

export class DatabaseBuilder extends BaseResourceBuilder<rds.DatabaseInstance | rds.DatabaseCluster, DatabaseConfig> {
    validate(): boolean {
        return ConfigValidator.validateDatabaseConfig(this.config);
    }

    build(): rds.DatabaseInstance | rds.DatabaseCluster {
        switch (this.config.engine) {
            case 'postgresql':
                return this.buildPostgres();
            case 'aurora-postgresql':
                return this.buildAuroraPostgres();
            default:
                throw new Error(`Unsupported database engine: ${this.config.engine}`);
        }
    }

    private buildPostgres(): rds.DatabaseInstance {
        const securityGroup = new ec2.SecurityGroup(this.scope, this.generateName('db-sg'), {
            vpc: this.config.vpc,
            description: 'Security group for PostgreSQL database',
            allowAllOutbound: true
        });

        const instance = new rds.DatabaseInstance(this.scope, this.generateName('db'), {
            vpc: this.config.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED
            },
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_15
            }),
            instanceType: this.config.instanceType,
            multiAz: this.config.multiAz,
            databaseName: this.config.databaseName,
            port: this.config.port || 5432,
            securityGroups: [securityGroup],
            storageEncrypted: this.config.encrypted !== false,
            removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
            deletionProtection: true,
            backupRetention: cdk.Duration.days(7),
            monitoringInterval: cdk.Duration.seconds(60)
        });

        this.addTags(instance);
        this.addTags(securityGroup);

        return instance;
    }

    private buildAuroraPostgres(): rds.DatabaseCluster {
        const securityGroup = new ec2.SecurityGroup(this.scope, this.generateName('aurora-sg'), {
            vpc: this.config.vpc,
            description: 'Security group for Aurora PostgreSQL cluster',
            allowAllOutbound: true
        });

        const cluster = new rds.DatabaseCluster(this.scope, this.generateName('aurora'), {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_15_2
            }),
            instanceProps: {
                vpc: this.config.vpc,
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED
                },
                instanceType: this.config.instanceType,
                securityGroups: [securityGroup]
            },
            instances: this.config.multiAz ? 2 : 1,
            port: this.config.port || 5432,
            defaultDatabaseName: this.config.databaseName,
            storageEncrypted: this.config.encrypted !== false,
            removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
            deletionProtection: true,
            backup: {
                retention: cdk.Duration.days(7),
                preferredWindow: '16:00-16:30'
            },
            cloudwatchLogsExports: ['postgresql'],
            monitoringInterval: cdk.Duration.seconds(60)
        });

        this.addTags(cluster);
        this.addTags(securityGroup);

        return cluster;
    }
}