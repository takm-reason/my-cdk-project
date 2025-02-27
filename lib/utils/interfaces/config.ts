import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';

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

export interface DatabaseConfig extends BaseConfig {
    vpc: ec2.Vpc;
    engine: 'aurora-postgresql' | 'postgresql';
    instanceType: ec2.InstanceType;
    multiAz: boolean;
    databaseName: string;
    port?: number;
    encrypted?: boolean;
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