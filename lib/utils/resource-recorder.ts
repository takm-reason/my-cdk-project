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
        this.ensureOutputDirectoryExists(this.outputDir);
        // YYYY-MM-DD形式で今日の日付を設定
        this.createdAt = new Date().toISOString().split('T')[0];
    }

    private ensureOutputDirectoryExists(dirPath: string) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
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

        const engineInfo = this.getEngineInfo(database);
        const secretArn = database.secret?.secretArn;
        const secretName = database.secret?.secretName;

        const baseProperties = {
            stackName,
            secret: {
                arn: secretArn,
                name: secretName
            },
            monitoring: {
                enhancedMonitoring: true,
                monitoringInterval: 60,
                performanceInsights: true
            },
            backup: {
                retention: database instanceof cdk.aws_rds.DatabaseInstance ? 7 : 14,
                preferredWindow: '16:00-17:00',
                automaticMinorVersionUpgrade: true
            },
            maintenance: {
                preferredWindow: '土 15:00-土 16:00',
                autoMinorVersionUpgrade: true
            },
            security: {
                storageEncrypted: true,
                publiclyAccessible: false,
                deletionProtection: true
            }
        };

        if (database instanceof cdk.aws_rds.DatabaseInstance) {
            this.recordResource({
                resourceType: 'RDS',
                resourceId: database.node.id,
                physicalId: database.instanceIdentifier,
                arn: `arn:aws:rds:${cdk.Stack.of(database).region}:${cdk.Stack.of(database).account}:db:${database.instanceIdentifier}`,
                properties: {
                    ...baseProperties,
                    instanceIdentifier: database.instanceIdentifier,
                    ...engineInfo,
                    storage: {
                        type: 'gp3',
                        allocatedStorage: 20,
                        maximumAllocatedStorage: 100
                    },
                    network: {
                        multiAz: false,
                        endpoint: {
                            address: database.instanceEndpoint.hostname,
                            port: database.instanceEndpoint.port
                        }
                    }
                }
            });
        } else {
            this.recordResource({
                resourceType: 'Aurora',
                resourceId: database.node.id,
                physicalId: database.clusterIdentifier,
                arn: `arn:aws:rds:${cdk.Stack.of(database).region}:${cdk.Stack.of(database).account}:cluster:${database.clusterIdentifier}`,
                properties: {
                    ...baseProperties,
                    clusterIdentifier: database.clusterIdentifier,
                    ...engineInfo,
                    serverlessv2: {
                        enabled: true,
                        minCapacity: 0.5,
                        maxCapacity: 4
                    },
                    network: {
                        multiAz: true,
                        endpoints: {
                            writer: {
                                address: database.clusterEndpoint.hostname,
                                port: database.clusterEndpoint.port
                            },
                            reader: database.clusterReadEndpoint ? {
                                address: database.clusterReadEndpoint.hostname,
                                port: database.clusterReadEndpoint.port
                            } : undefined
                        }
                    },
                    instances: database.instanceIdentifiers
                }
            });
        }
    }

    public recordS3(bucket: cdk.aws_s3.IBucket, stackName: string) {
        this.applyRequiredTags(bucket);

        const region = cdk.Stack.of(bucket).region;
        const bucketName = bucket.bucketName;

        this.recordResource({
            resourceType: 'S3',
            resourceId: bucket.node.id,
            physicalId: bucketName,
            arn: bucket.bucketArn,
            properties: {
                stackName,
                bucket: {
                    name: bucketName,
                    region: region,
                    domainName: bucket.bucketDomainName
                },
                endpoints: {
                    s3: `https://s3.${region}.amazonaws.com/${bucketName}`,
                    website: bucket.bucketWebsiteUrl,
                    transfer: `https://${bucketName}.s3.${region}.amazonaws.com`
                },
                features: {
                    versioning: true,
                    encryption: {
                        enabled: true,
                        type: 'AES256'
                    },
                    publicAccess: {
                        enabled: false,
                        blockConfiguration: {
                            blockPublicAcls: true,
                            blockPublicPolicy: true,
                            ignorePublicAcls: true,
                            restrictPublicBuckets: true
                        }
                    },
                    logging: {
                        enabled: false
                    }
                }
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

        const targetGroup = service.targetGroup;
        const loadBalancer = service.loadBalancer;
        const taskDefinition = service.taskDefinition;
        const fargateService = service.service;

        this.recordResource({
            resourceType: 'ECS',
            resourceId: cluster.node.id,
            physicalId: cluster.clusterName,
            arn: cluster.clusterArn,
            properties: {
                stackName,
                cluster: {
                    name: cluster.clusterName,
                    arn: cluster.clusterArn,
                    capacityProviders: ['FARGATE', 'FARGATE_SPOT']
                },
                service: {
                    name: fargateService.serviceName,
                    arn: fargateService.serviceArn,
                    platform_version: 'LATEST'
                },
                taskDefinition: {
                    family: taskDefinition.family,
                    arn: taskDefinition.taskDefinitionArn,
                    cpu: taskDefinition.cpu,
                    container: {
                        name: taskDefinition.defaultContainer?.containerName,
                        port: taskDefinition.defaultContainer?.containerPort
                    }
                },
                loadBalancer: {
                    name: loadBalancer.loadBalancerName,
                    arn: loadBalancer.loadBalancerArn,
                    dnsName: loadBalancer.loadBalancerDnsName,
                    type: 'application'
                },
                targetGroup: {
                    name: targetGroup.node.id,
                    arn: targetGroup.targetGroupArn,
                    healthCheck: {
                        path: '/health',
                        port: 'traffic-port',
                        protocol: 'HTTP'
                    }
                }
            }
        });
    }

    public recordElastiCache(redisCluster: cdk.aws_elasticache.CfnCacheCluster | cdk.aws_elasticache.CfnReplicationGroup, stackName: string) {
        this.applyRequiredTags(redisCluster);

        if (redisCluster instanceof cdk.aws_elasticache.CfnCacheCluster) {
            const clusterId = redisCluster.ref;
            this.recordResource({
                resourceType: 'ElastiCache',
                resourceId: redisCluster.node.id,
                physicalId: clusterId,
                arn: `arn:aws:elasticache:${cdk.Stack.of(redisCluster).region}:${cdk.Stack.of(redisCluster).account}:cluster:${clusterId}`,
                properties: {
                    stackName,
                    cluster: {
                        id: clusterId,
                        engine: redisCluster.engine,
                        engineVersion: redisCluster.engineVersion,
                        nodeType: redisCluster.cacheNodeType,
                        numNodes: redisCluster.numCacheNodes
                    },
                    network: {
                        endpoint: {
                            address: redisCluster.attrRedisEndpointAddress,
                            port: redisCluster.attrRedisEndpointPort
                        }
                    },
                    features: {
                        maintenance: {
                            window: redisCluster.preferredMaintenanceWindow || '日 15:00-日 16:00'
                        },
                        backup: {
                            retention: 0,
                            window: '14:00-15:00'
                        },
                        security: {
                            transitEncryption: false,
                            atRestEncryption: false
                        }
                    }
                }
            });
        } else {
            const replicationGroupId = redisCluster.ref;
            this.recordResource({
                resourceType: 'ElastiCache',
                resourceId: redisCluster.node.id,
                physicalId: replicationGroupId,
                arn: `arn:aws:elasticache:${cdk.Stack.of(redisCluster).region}:${cdk.Stack.of(redisCluster).account}:replicationgroup:${replicationGroupId}`,
                properties: {
                    stackName,
                    cluster: {
                        id: replicationGroupId,
                        engine: redisCluster.engine,
                        engineVersion: redisCluster.engineVersion,
                        nodeType: redisCluster.cacheNodeType,
                        configuration: {
                            nodeGroups: redisCluster.numNodeGroups,
                            replicasPerNodeGroup: redisCluster.replicasPerNodeGroup,
                            automaticFailover: redisCluster.automaticFailoverEnabled,
                            multiAz: redisCluster.multiAzEnabled
                        }
                    },
                    network: {
                        endpoints: {
                            configuration: {
                                address: redisCluster.attrConfigurationEndPointAddress,
                                port: redisCluster.attrConfigurationEndPointPort
                            }
                        }
                    },
                    features: {
                        maintenance: {
                            window: redisCluster.preferredMaintenanceWindow || '日 15:00-日 16:00'
                        },
                        backup: {
                            retention: 0,
                            window: '14:00-15:00'
                        },
                        security: {
                            transitEncryption: redisCluster.transitEncryptionEnabled || false,
                            atRestEncryption: redisCluster.atRestEncryptionEnabled || false
                        }
                    }
                }
            });
        }
    }

    public recordCloudFront(distribution: cdk.aws_cloudfront.Distribution, stackName: string) {
        this.applyRequiredTags(distribution);

        const distributionId = distribution.distributionId;

        this.recordResource({
            resourceType: 'CloudFront',
            resourceId: distribution.node.id,
            physicalId: distributionId,
            arn: `arn:aws:cloudfront::${cdk.Stack.of(distribution).account}:distribution/${distributionId}`,
            properties: {
                stackName,
                distribution: {
                    id: distributionId,
                    domainName: distribution.distributionDomainName,
                    status: 'Deployed',
                    url: `https://${distribution.distributionDomainName}`
                },
                configuration: {
                    priceClass: 'PriceClass_200',
                    enabled: true,
                    defaultRootObject: 'index.html',
                    httpVersion: 'http2',
                    ipv6Enabled: true,
                    certificateSource: 'cloudfront'
                },
                restrictions: {
                    geoRestriction: {
                        restrictionType: 'none'
                    }
                },
                security: {
                    webAclEnabled: true,
                    sslSupportMethod: 'sni-only',
                    minimumProtocolVersion: 'TLSv1.2_2021',
                    originAccessIdentityEnabled: true
                }
            }
        });
    }

    public recordWaf(waf: cdk.aws_wafv2.CfnWebACL, stackName: string) {
        this.applyRequiredTags(waf);

        const webAclId = waf.attrId;

        this.recordResource({
            resourceType: 'WAF',
            resourceId: waf.node.id,
            physicalId: webAclId,
            arn: waf.attrArn,
            properties: {
                stackName,
                webAcl: {
                    id: webAclId,
                    name: waf.name,
                    scope: waf.scope,
                    region: cdk.Stack.of(waf).region
                },
                configuration: {
                    capacity: 50,
                    defaultAction: {
                        type: 'allow'
                    },
                    rules: [
                        {
                            name: 'AWSManagedRulesCommonRuleSet',
                            priority: 1,
                            overrideAction: 'none',
                            vendorName: 'AWS',
                            managedRuleGroupName: 'AWSManagedRulesCommonRuleSet'
                        },
                        {
                            name: 'RateBasedRule',
                            priority: 2,
                            action: 'block',
                            type: 'RATE_BASED',
                            limit: 2000
                        }
                    ]
                },
                monitoring: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: `${stackName}-WAFMetrics`
                }
            }
        });
    }

    public recordShieldProtection(shield: cdk.aws_shield.CfnProtection, stackName: string) {
        this.applyRequiredTags(shield);

        const protectionId = shield.attrProtectionId;
        const region = cdk.Stack.of(shield).region;
        const account = cdk.Stack.of(shield).account;

        this.recordResource({
            resourceType: 'Shield',
            resourceId: shield.node.id,
            physicalId: protectionId,
            arn: `arn:aws:shield:${region}:${account}:protection/${protectionId}`,
            properties: {
                stackName,
                protection: {
                    id: protectionId,
                    name: shield.name,
                    resourceArn: shield.resourceArn,
                    resourceType: shield.resourceArn.split(':')[2]
                },
                configuration: {
                    enabled: true,
                    type: 'Shield Advanced',
                    ddosProtection: {
                        enabled: true,
                        protectionLayers: ['NETWORK', 'APPLICATION']
                    },
                    healthChecks: {
                        enabled: true,
                        healthyThreshold: 3,
                        unhealthyThreshold: 3,
                        interval: 30
                    }
                },
                monitoring: {
                    metrics: {
                        enabled: true,
                        namespace: 'AWS/DDoSProtection'
                    },
                    alerts: {
                        enabled: true,
                        types: ['DDoS', 'Application Layer', 'SYN Flood']
                    }
                }
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
        const projectDir = path.join(this.outputDir, this.projectName);
        this.ensureOutputDirectoryExists(projectDir);
        const filePath = path.join(projectDir, fileName);

        const output = {
            projectName: this.projectName,
            timestamp: new Date().toISOString(),
            resources: this.resources
        };

        fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
        console.log(`Resource information saved to: ${filePath}`);
    }
}