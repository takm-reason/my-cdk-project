import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';

export type CacheNodeType =
    | 'cache.t4g.micro'
    | 'cache.t4g.small'
    | 'cache.t4g.medium'
    | 'cache.r6g.large'
    | 'cache.r6g.xlarge'
    | 'cache.r6g.2xlarge'
    | 'cache.r6g.4xlarge'
    | 'cache.r6g.8xlarge'
    | 'cache.r6g.12xlarge'
    | 'cache.r6g.16xlarge';

export interface BaseConfig {
    projectName: string;
    environment: 'production' | 'staging' | 'development';
    tags?: { [key: string]: string };
}

export interface VpcConfig extends BaseConfig {
    maxAzs: number;
    natGateways: number;
    vpcName: string;
}

export interface DatabaseInstanceConfig extends BaseConfig {
    vpc: ec2.Vpc;
    engine: 'postgresql';
    version: rds.PostgresEngineVersion;
    instanceType: ec2.InstanceType;
    multiAz: boolean;
    databaseName: string;
    port?: number;
    encrypted?: boolean;
    storageConfig?: {
        allocatedStorage: number;
        maxAllocatedStorage?: number;
        storageType?: rds.StorageType;
        iops?: number;
    };
    backup?: {
        retention: number;
        preferredWindow?: string;
        deletionProtection?: boolean;
    };
    maintenance?: {
        preferredWindow?: string;
        autoMinorVersionUpgrade?: boolean;
    };
    monitoring?: {
        enablePerformanceInsights?: boolean;
        enableEnhancedMonitoring?: boolean;
        monitoringInterval?: number;
    };
}

export interface AuroraConfig extends BaseConfig {
    vpc: ec2.Vpc;
    engine: 'aurora-postgresql';
    version: rds.AuroraPostgresEngineVersion;
    instanceType: ec2.InstanceType;
    instances: number;
    databaseName: string;
    port?: number;
    serverless?: {
        minCapacity: number;
        maxCapacity: number;
        autoPause?: boolean;
        secondsUntilAutoPause?: number;
    };
    backup?: {
        retention: number;
        preferredWindow?: string;
        deletionProtection?: boolean;
    };
    maintenance?: {
        preferredWindow?: string;
        autoMinorVersionUpgrade?: boolean;
    };
    monitoring?: {
        enablePerformanceInsights?: boolean;
        enableEnhancedMonitoring?: boolean;
        monitoringInterval?: number;
    };
    replication?: {
        enableGlobalDatabase?: boolean;
        regions?: string[];
    };
}

export interface CacheConfig extends BaseConfig {
    vpc: ec2.Vpc;
    engine: 'redis';
    version: string;
    nodeType: CacheNodeType;
    multiAz?: boolean;
    replication?: {
        numNodeGroups?: number;
        replicasPerNodeGroup?: number;
    };
    maintenance?: {
        preferredWindow?: string;
        autoMinorVersionUpgrade?: boolean;
    };
    backup?: {
        retention: number;
        preferredWindow?: string;
    };
    parameterGroup?: {
        family: string;
        parameters?: { [key: string]: string };
    };
}

export interface EcsServiceConfig extends BaseConfig {
    vpc: ec2.Vpc;
    cpu: number;
    memoryLimitMiB: number;
    desiredCount: number;
    minCapacity: number;
    maxCapacity: number;
    containerPort: number;
    serviceConfig: {
        name: string;
        image: string;
        environment?: { [key: string]: string };
    };
    loadBalancer?: {
        public?: boolean;
        healthCheck?: {
            path: string;
            interval?: number;
            timeout?: number;
            healthyThreshold?: number;
            unhealthyThreshold?: number;
        };
        scaling?: {
            targetCpuUtilization?: number;
            targetMemoryUtilization?: number;
            scaleInCooldown?: number;
            scaleOutCooldown?: number;
        };
    };
}

export interface StorageConfig extends BaseConfig {
    bucketName: string;
    versioned?: boolean;
    lifecycleRules?: Array<{
        enabled: boolean;
        expiration?: number;
        transitions?: Array<{
            storageClass: string;
            transitionAfter: number;
        }>;
    }>;
}

export interface SecurityGroupConfig extends BaseConfig {
    vpc: ec2.Vpc;
    name: string;
    description: string;
    allowInbound?: Array<{
        port: number;
        source: ec2.IPeer;
        description?: string;
    }>;
}

export interface MonitoringConfig extends BaseConfig {
    namespace: string;
    dashboardName?: string;
    alarms?: Array<{
        metricName: string;
        threshold: number;
        evaluationPeriods: number;
    }>;
}

export interface CdnConfig extends BaseConfig {
    s3Bucket: s3.IBucket;
    customDomain?: {
        domainName: string;
        certificate: acm.ICertificate;
    };
    webAcl?: wafv2.CfnWebACL;
    enableLogging?: boolean;
    logRetentionDays?: number;
}

export interface WafConfig extends BaseConfig {
    scope: 'CLOUDFRONT' | 'REGIONAL';
    rules?: Array<{
        name: string;
        priority: number;
        action: 'allow' | 'block' | 'count';
        overrideAction?: 'none' | 'count';
        statement: any;
        visibilityConfig?: {
            cloudWatchMetricsEnabled?: boolean;
            metricName?: string;
            sampledRequestsEnabled?: boolean;
        };
        customResponse?: {
            responseCode: number;
            responseBodyKey?: string;
        };
    }>;
    defaultAction?: 'allow' | 'block';
    customResponseBodies?: { [key: string]: string };
}

export interface IamRoleConfig extends BaseConfig {
    roleName: string;
    description: string;
    assumedBy: iam.ServicePrincipal | iam.AccountPrincipal | iam.IPrincipal;
    managedPolicies?: string[];
    inlinePolicies?: {
        [name: string]: {
            actions: string[];
            resources: string[];
            effect?: iam.Effect;
            conditions?: { [key: string]: any };
        }[];
    };
    maxSessionDuration?: number;
}

export interface IamPolicyConfig extends BaseConfig {
    policyName: string;
    description: string;
    statements: Array<{
        actions: string[];
        resources: string[];
        effect?: iam.Effect;
        conditions?: { [key: string]: any };
    }>;
}