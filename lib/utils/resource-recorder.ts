import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

export interface ResourceInfo {
    resourceType: string;
    resourceId: string;
    physicalId?: string;
    arn?: string;
    properties: { [key: string]: any };
}

// 必須タグの定義
const REQUIRED_TAGS = {
    Project: '', // constructorで設定
    Environment: 'development', // デフォルト値
    CreatedBy: 'cdk',
    CreatedAt: '', // constructorで設定
};

export class ResourceRecorder {
    private readonly projectName: string;
    private readonly outputDir: string;
    private resources: ResourceInfo[] = [];
    private readonly createdAt: string;

    constructor(projectName: string) {
        this.projectName = projectName;
        this.outputDir = path.join(process.cwd(), 'projects');
        this.ensureOutputDirectoryExists();
        // YYYY-MM-DD形式で今日の日付を設定
        this.createdAt = new Date().toISOString().split('T')[0];
    }

    private ensureOutputDirectoryExists() {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // 必須タグを付与するヘルパーメソッド
    private applyRequiredTags(construct: IConstruct) {
        const tags = {
            ...REQUIRED_TAGS,
            Project: this.projectName,
            CreatedAt: this.createdAt,
        };

        Object.entries(tags).forEach(([key, value]) => {
            cdk.Tags.of(construct).add(key, value);
        });
    }

    public recordResource(resource: ResourceInfo) {
        this.resources.push(resource);
    }

    public recordVpc(vpc: cdk.aws_ec2.IVpc, stackName: string) {
        const vpcResource = vpc as cdk.aws_ec2.Vpc;
        this.applyRequiredTags(vpcResource);

        this.recordResource({
            resourceType: 'VPC',
            resourceId: vpc.node.id,
            properties: {
                stackName,
                vpcId: vpc.vpcId,
                vpcCidr: vpc.vpcCidrBlock,
                availabilityZones: vpc.availabilityZones,
                publicSubnets: vpc.publicSubnets.map(subnet => ({
                    id: subnet.subnetId,
                    availabilityZone: subnet.availabilityZone,
                    cidr: subnet.ipv4CidrBlock
                })),
                privateSubnets: vpc.privateSubnets.map(subnet => ({
                    id: subnet.subnetId,
                    availabilityZone: subnet.availabilityZone,
                    cidr: subnet.ipv4CidrBlock
                }))
            }
        });
    }

    private getEngineInfo(database: cdk.aws_rds.DatabaseInstance | cdk.aws_rds.DatabaseCluster) {
        if (database instanceof cdk.aws_rds.DatabaseInstance) {
            return {
                engineType: database.engine?.engineType || 'unknown',
                engineVersion: database.engine?.engineVersion?.fullVersion || 'unknown'
            };
        } else {
            return {
                engineType: database.engine?.engineType || 'unknown',
                engineVersion: database.engine?.engineVersion?.fullVersion || 'unknown'
            };
        }
    }

    public recordRds(database: cdk.aws_rds.DatabaseInstance | cdk.aws_rds.DatabaseCluster, stackName: string) {
        this.applyRequiredTags(database);

        const baseProperties = {
            stackName,
            databaseName: database.secret?.secretName
        };

        const engineInfo = this.getEngineInfo(database);

        if (database instanceof cdk.aws_rds.DatabaseInstance) {
            this.recordResource({
                resourceType: 'RDS',
                resourceId: database.node.id,
                properties: {
                    ...baseProperties,
                    instanceIdentifier: database.instanceIdentifier,
                    ...engineInfo,
                    endpointAddress: database.instanceEndpoint.hostname,
                    port: database.instanceEndpoint.port
                }
            });
        } else {
            this.recordResource({
                resourceType: 'Aurora',
                resourceId: database.node.id,
                properties: {
                    ...baseProperties,
                    clusterIdentifier: database.clusterIdentifier,
                    ...engineInfo,
                    endpointAddress: database.clusterEndpoint.hostname,
                    port: database.clusterEndpoint.port,
                    readerEndpointAddress: database.clusterReadEndpoint?.hostname,
                    instances: database.instanceIdentifiers
                }
            });
        }
    }

    public recordS3(bucket: cdk.aws_s3.IBucket, stackName: string) {
        this.applyRequiredTags(bucket);

        this.recordResource({
            resourceType: 'S3',
            resourceId: bucket.node.id,
            properties: {
                stackName,
                bucketName: bucket.bucketName,
                bucketArn: bucket.bucketArn,
                bucketDomainName: bucket.bucketDomainName,
                bucketWebsiteUrl: bucket.bucketWebsiteUrl
            }
        });
    }

    public recordEcs(
        cluster: cdk.aws_ecs.ICluster,
        service: cdk.aws_ecs_patterns.ApplicationLoadBalancedFargateService,
        stackName: string
    ) {
        // クラスター、サービス、ロードバランサーにタグを適用
        this.applyRequiredTags(cluster);
        this.applyRequiredTags(service);
        this.applyRequiredTags(service.loadBalancer);

        this.recordResource({
            resourceType: 'ECS',
            resourceId: cluster.node.id,
            properties: {
                stackName,
                clusterName: cluster.clusterName,
                clusterArn: cluster.clusterArn,
                serviceArn: service.service.serviceArn,
                loadBalancerDns: service.loadBalancer.loadBalancerDnsName,
                taskDefinitionArn: service.taskDefinition.taskDefinitionArn,
                containerName: service.taskDefinition.defaultContainer?.containerName
            }
        });
    }

    public recordElastiCache(redisCluster: cdk.aws_elasticache.CfnCacheCluster | cdk.aws_elasticache.CfnReplicationGroup, stackName: string) {
        this.applyRequiredTags(redisCluster);

        if (redisCluster instanceof cdk.aws_elasticache.CfnCacheCluster) {
            this.recordResource({
                resourceType: 'ElastiCache',
                resourceId: redisCluster.node.id,
                properties: {
                    stackName,
                    engine: redisCluster.engine,
                    nodeType: redisCluster.cacheNodeType,
                    numNodes: redisCluster.numCacheNodes,
                    endpoint: redisCluster.attrRedisEndpointAddress,
                    port: redisCluster.attrRedisEndpointPort
                }
            });
        } else {
            this.recordResource({
                resourceType: 'ElastiCache',
                resourceId: redisCluster.node.id,
                properties: {
                    stackName,
                    engine: redisCluster.engine,
                    nodeType: redisCluster.cacheNodeType,
                    numNodeGroups: redisCluster.numNodeGroups,
                    replicasPerNodeGroup: redisCluster.replicasPerNodeGroup,
                    automaticFailoverEnabled: redisCluster.automaticFailoverEnabled,
                    multiAzEnabled: redisCluster.multiAzEnabled,
                    endpoint: redisCluster.attrConfigurationEndPointAddress,
                    port: redisCluster.attrConfigurationEndPointPort
                }
            });
        }
    }

    public recordCloudFront(distribution: cdk.aws_cloudfront.Distribution, stackName: string) {
        this.applyRequiredTags(distribution);

        this.recordResource({
            resourceType: 'CloudFront',
            resourceId: distribution.node.id,
            properties: {
                stackName,
                distributionId: distribution.distributionId,
                domainName: distribution.distributionDomainName
            }
        });
    }

    public recordWaf(waf: cdk.aws_wafv2.CfnWebACL, stackName: string) {
        this.applyRequiredTags(waf);

        this.recordResource({
            resourceType: 'WAF',
            resourceId: waf.node.id,
            properties: {
                stackName,
                webAclArn: waf.attrArn,
                webAclId: waf.attrId,
                scope: waf.scope
            }
        });
    }

    public recordShieldProtection(shield: cdk.aws_shield.CfnProtection, stackName: string) {
        this.applyRequiredTags(shield);

        this.recordResource({
            resourceType: 'Shield',
            resourceId: shield.node.id,
            properties: {
                stackName,
                protectionName: shield.name,
                resourceArn: shield.resourceArn
            }
        });
    }

    public recordCodePipeline(pipeline: cdk.aws_codepipeline.Pipeline, stackName: string) {
        this.applyRequiredTags(pipeline);

        this.recordResource({
            resourceType: 'CodePipeline',
            resourceId: pipeline.node.id,
            properties: {
                stackName,
                pipelineName: pipeline.pipelineName,
                pipelineArn: pipeline.pipelineArn
            }
        });
    }

    public recordCloudWatchDashboard(dashboard: cdk.aws_cloudwatch.Dashboard, stackName: string) {
        this.applyRequiredTags(dashboard);

        this.recordResource({
            resourceType: 'CloudWatchDashboard',
            resourceId: dashboard.node.id,
            properties: {
                stackName,
                dashboardName: dashboard.dashboardName,
                dashboardArn: dashboard.dashboardArn
            }
        });
    }

    public recordParameter(parameter: cdk.aws_ssm.StringParameter, stackName: string) {
        this.applyRequiredTags(parameter);

        this.recordResource({
            resourceType: 'SSM Parameter',
            resourceId: parameter.node.id,
            properties: {
                stackName,
                parameterName: parameter.parameterName,
                parameterArn: parameter.parameterArn,
                parameterType: parameter.parameterType
            }
        });
    }

    public saveToFile() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${this.projectName}-${timestamp}.json`;
        const filePath = path.join(this.outputDir, fileName);

        const output = {
            projectName: this.projectName,
            timestamp: new Date().toISOString(),
            resources: this.resources
        };

        fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
        console.log(`Resource information saved to: ${filePath}`);
    }
}