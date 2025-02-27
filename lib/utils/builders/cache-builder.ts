import * as cdk from 'aws-cdk-lib';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { BaseResourceBuilder } from '../core/stack-builder';
import { CacheConfig } from '../interfaces/config';
import { ConfigValidator } from '../helpers/validators';

export class CacheBuilder extends BaseResourceBuilder<elasticache.CfnCacheCluster | elasticache.CfnReplicationGroup, CacheConfig> {
    validate(): boolean {
        return this.validateCacheConfig(this.config);
    }

    private validateCacheConfig(config: CacheConfig): boolean {
        if (!config.vpc || !config.nodeType || !config.version) {
            throw new Error('Cache configuration must include vpc, nodeType, and version');
        }
        return true;
    }

    build(): elasticache.CfnCacheCluster | elasticache.CfnReplicationGroup {
        // サブネットグループの作成
        const subnetGroup = this.createSubnetGroup();

        // パラメータグループの作成
        const parameterGroup = this.createParameterGroup();

        // マルチAZとレプリケーションが必要な場合はReplication Groupを作成
        if (this.config.multiAz || (this.config.replication &&
            (this.config.replication.numNodeGroups || this.config.replication.replicasPerNodeGroup))) {
            return this.createReplicationGroup(subnetGroup, parameterGroup);
        }

        // それ以外の場合は単一のキャッシュクラスターを作成
        return this.createSingleNodeCluster(subnetGroup, parameterGroup);
    }

    private createSubnetGroup(): elasticache.CfnSubnetGroup {
        const subnetGroup = new elasticache.CfnSubnetGroup(this.scope, this.generateName('subnet-group'), {
            description: `Subnet group for ${this.config.projectName} Redis cluster`,
            subnetIds: this.config.vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            }).subnetIds,
        });

        cdk.Tags.of(subnetGroup).add('Name', `${this.config.projectName}-redis-subnet-group`);
        return subnetGroup;
    }

    private createParameterGroup(): elasticache.CfnParameterGroup {
        // パラメータグループの作成
        const parameterGroup = new elasticache.CfnParameterGroup(this.scope, this.generateName('parameter-group'), {
            cacheParameterGroupFamily: this.config.parameterGroup?.family || 'redis6.x',
            description: `Parameter group for ${this.config.projectName} Redis cluster`,
        });

        // カスタムパラメータの設定
        if (this.config.parameterGroup?.parameters) {
            const cfnParamGroup = parameterGroup.node.defaultChild as elasticache.CfnParameterGroup;
            cfnParamGroup.addPropertyOverride('Parameters', this.config.parameterGroup.parameters);
        }

        cdk.Tags.of(parameterGroup).add('Name', `${this.config.projectName}-redis-parameter-group`);
        return parameterGroup;
    }

    private createSecurityGroup(): ec2.SecurityGroup {
        const securityGroup = new ec2.SecurityGroup(this.scope, this.generateName('security-group'), {
            vpc: this.config.vpc,
            description: `Security group for ${this.config.projectName} Redis cluster`,
            allowAllOutbound: true,
        });

        cdk.Tags.of(securityGroup).add('Name', `${this.config.projectName}-redis-security-group`);
        return securityGroup;
    }

    private createSingleNodeCluster(
        subnetGroup: elasticache.CfnSubnetGroup,
        parameterGroup: elasticache.CfnParameterGroup
    ): elasticache.CfnCacheCluster {
        const securityGroup = this.createSecurityGroup();

        const cluster = new elasticache.CfnCacheCluster(this.scope, this.generateName('redis'), {
            engine: 'redis',
            cacheNodeType: this.config.nodeType,
            numCacheNodes: 1,
            engineVersion: this.config.version,
            vpcSecurityGroupIds: [securityGroup.securityGroupId],
            cacheSubnetGroupName: subnetGroup.ref,
            cacheParameterGroupName: parameterGroup.ref,
            autoMinorVersionUpgrade: this.config.maintenance?.autoMinorVersionUpgrade ?? true,
            preferredMaintenanceWindow: this.config.maintenance?.preferredWindow,
            port: 6379,
        });

        cdk.Tags.of(cluster).add('Name', `${this.config.projectName}-redis-cluster`);
        return cluster;
    }

    private createReplicationGroup(
        subnetGroup: elasticache.CfnSubnetGroup,
        parameterGroup: elasticache.CfnParameterGroup
    ): elasticache.CfnReplicationGroup {
        const securityGroup = this.createSecurityGroup();

        const replicationGroup = new elasticache.CfnReplicationGroup(this.scope, this.generateName('redis'), {
            replicationGroupDescription: `Redis cluster for ${this.config.projectName}`,
            engine: 'redis',
            cacheNodeType: this.config.nodeType,
            engineVersion: this.config.version,
            automaticFailoverEnabled: this.config.multiAz ?? true,
            multiAzEnabled: this.config.multiAz ?? true,
            numNodeGroups: this.config.replication?.numNodeGroups || 1,
            replicasPerNodeGroup: this.config.replication?.replicasPerNodeGroup || 1,
            securityGroupIds: [securityGroup.securityGroupId],
            cacheSubnetGroupName: subnetGroup.ref,
            cacheParameterGroupName: parameterGroup.ref,
            autoMinorVersionUpgrade: this.config.maintenance?.autoMinorVersionUpgrade ?? true,
            preferredMaintenanceWindow: this.config.maintenance?.preferredWindow,
            port: 6379,
            ...(this.config.backup && {
                snapshotRetentionLimit: this.config.backup.retention,
                snapshotWindow: this.config.backup.preferredWindow,
            }),
        });

        cdk.Tags.of(replicationGroup).add('Name', `${this.config.projectName}-redis-replication-group`);
        return replicationGroup;
    }

    public createRedis(): elasticache.CfnCacheCluster | elasticache.CfnReplicationGroup {
        return this.build();
    }
}