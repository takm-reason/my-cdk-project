import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
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
        this.outputDir = path.join(process.cwd(), 'resource-info');
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
                containerName: service.taskDefinition.defaultContainer?.containerName,
                cpu: service.taskDefinition.cpu
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
                domainName: distribution.distributionDomainName,
                distributionArn: distribution.distributionArn
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

    private generateRailsConfig(): any {
        // リソース情報から必要な値を取得
        const rdsInfo = this.resources.find(r => r.resourceType === 'RDS' || r.resourceType === 'Aurora');
        const s3Info = this.resources.find(r => r.resourceType === 'S3');
        const ecsInfo = this.resources.find(r => r.resourceType === 'ECS');

        return {
            rails: {
                master_key: '# bin/rails credentials:edit で生成したmaster.keyの値を設定してください',
            },
            database: {
                host: rdsInfo?.properties.endpointAddress,
                port: rdsInfo?.properties.port || 5432,
                name: 'app_production',
                username: 'postgres',
                password: '# RDSのマスターパスワードを設定してください',
            },
            aws: {
                s3_bucket: s3Info?.properties.bucketName,
                region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
            },
            application: {
                host: ecsInfo?.properties.loadBalancerDns,
            }
        };
    }

    private generateAwsResourcesConfig(): any {
        const region = process.env.CDK_DEFAULT_REGION || 'ap-northeast-1';
        const timestamp = new Date().toISOString();

        return {
            project_info: {
                name: this.projectName,
                environment: 'production',
                created_at: timestamp,
                region: region,
                account_id: process.env.CDK_DEFAULT_ACCOUNT,
            },
            vpc: this.resources.find(r => r.resourceType === 'VPC')?.properties,
            rds: this.resources.find(r => r.resourceType === 'RDS' || r.resourceType === 'Aurora')?.properties,
            s3: this.resources.find(r => r.resourceType === 'S3')?.properties,
            ecs: {
                ...this.resources.find(r => r.resourceType === 'ECS')?.properties,
                ecr_repository: `${this.projectName}-rails-app`,
            },
            load_balancer: {
                dns_name: this.resources.find(r => r.resourceType === 'ECS')?.properties.loadBalancerDns,
            },
            security_groups: this.resources.filter(r => r.resourceType === 'SecurityGroup').map(r => r.properties),
            cloudwatch: {
                log_group: `/aws/ecs/${this.projectName}`,
            }
        };
    }

    private ensureProjectDirectory(): string {
        // プロジェクトのルートディレクトリを作成
        const projectDir = path.join(this.outputDir, this.projectName);
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        // Rails設定用のディレクトリを作成
        const railsConfigDir = path.join(projectDir, 'rails');
        if (!fs.existsSync(railsConfigDir)) {
            fs.mkdirSync(railsConfigDir, { recursive: true });
        }

        // AWSリソース情報用のディレクトリを作成
        const awsResourcesDir = path.join(projectDir, 'aws');
        if (!fs.existsSync(awsResourcesDir)) {
            fs.mkdirSync(awsResourcesDir, { recursive: true });
        }

        return projectDir;
    }

    public saveToFile() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const projectDir = this.ensureProjectDirectory();

        // Rails設定をYAMLで保存（最小限の設定）
        const railsConfig = this.generateRailsConfig();
        const railsConfigPath = path.join(projectDir, 'rails/config.yml');
        fs.writeFileSync(railsConfigPath, yaml.stringify(railsConfig, { lineWidth: 0 }));
        console.log(`Rails deployment configuration saved to: ${railsConfigPath}`);

        // AWS環境の詳細情報をYAMLで保存
        const awsResourcesConfig = this.generateAwsResourcesConfig();
        const awsResourcesPath = path.join(projectDir, 'aws/resources.yml');
        fs.writeFileSync(awsResourcesPath, yaml.stringify(awsResourcesConfig, { lineWidth: 0 }));
        console.log(`AWS resources information saved to: ${awsResourcesPath}`);

        // 生のリソース情報をJSONで保存（デバッグ用）
        const rawDataPath = path.join(projectDir, 'aws/raw-data.json');
        const output = {
            projectName: this.projectName,
            timestamp: new Date().toISOString(),
            resources: this.resources
        };
        fs.writeFileSync(rawDataPath, JSON.stringify(output, null, 2));
        console.log(`Raw resource information saved to: ${rawDataPath}`);

        // READMEを生成
        const readmePath = path.join(projectDir, 'README.md');
        const readmeContent = this.generateReadme(timestamp);
        fs.writeFileSync(readmePath, readmeContent);
        console.log(`Project README saved to: ${readmePath}`);
    }

    private generateReadme(timestamp: string): string {
        const rdsInfo = this.resources.find(r => r.resourceType === 'RDS' || r.resourceType === 'Aurora');
        const s3Info = this.resources.find(r => r.resourceType === 'S3');
        const ecsInfo = this.resources.find(r => r.resourceType === 'ECS');

        return `# ${this.projectName} AWS Environment

Generated at: ${new Date(timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

## 構成情報

- RDS Endpoint: ${rdsInfo?.properties.endpointAddress || 'N/A'}
- S3 Bucket: ${s3Info?.properties.bucketName || 'N/A'}
- Load Balancer: ${ecsInfo?.properties.loadBalancerDns || 'N/A'}

## ファイル構成

\`\`\`
${this.projectName}/
├── rails/
│   └── config.yml  # Railsアプリケーションの設定ファイル
└── aws/
    ├── resources.yml  # AWSリソース情報
    └── raw-data.json  # 詳細なリソース情報（デバッグ用）
\`\`\`

## Railsプロジェクトへの設定適用

1. \`rails/config.yml\` を Rails プロジェクトの \`config/\` ディレクトリにコピー
2. 以下の項目を設定：
   - \`rails.master_key\`
   - \`database.password\`

## 詳細情報の参照

AWS環境の詳細情報は \`aws/resources.yml\` を参照してください。
`;
    }