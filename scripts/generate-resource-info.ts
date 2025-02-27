import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { execSync } from 'child_process';

interface ResourceInfo {
    stackName: string;
    environment: string;
    region: string;
    resources: {
        vpc?: {
            vpcId: string;
            publicSubnets: string[];
            privateSubnets: string[];
            isolatedSubnets: string[];
        };
        database?: {
            type: 'rds' | 'aurora';
            endpoint: string;
            port: number;
            engine: string;
            version: string;
        };
        cache?: {
            type: 'redis';
            endpoint: string;
            port: number;
            engine: string;
            version: string;
        };
        ecs?: {
            clusterName: string;
            serviceName: string;
            taskDefinition: string;
        };
        s3?: {
            bucketName: string;
            websiteUrl?: string;
        };
        cloudfront?: {
            distributionId: string;
            domainName: string;
        };
        waf?: {
            webAclId: string;
            scope: string;
        };
    };
    tags: {
        [key: string]: string;
    };
    createdAt: string;
    updatedAt: string;
}

function getStackOutputs(stackName: string): { [key: string]: string } {
    try {
        const output = execSync(`aws cloudformation describe-stacks --stack-name ${stackName}`);
        const data = JSON.parse(output.toString());
        const outputs: { [key: string]: string } = {};

        if (data.Stacks && data.Stacks[0] && data.Stacks[0].Outputs) {
            data.Stacks[0].Outputs.forEach((output: any) => {
                outputs[output.OutputKey] = output.OutputValue;
            });
        }

        return outputs;
    } catch (error) {
        console.error(`Error getting stack outputs for ${stackName}:`, error);
        return {};
    }
}

function getStackResources(stackName: string): any[] {
    try {
        const output = execSync(`aws cloudformation describe-stack-resources --stack-name ${stackName}`);
        const data = JSON.parse(output.toString());
        return data.StackResources || [];
    } catch (error) {
        console.error(`Error getting stack resources for ${stackName}:`, error);
        return [];
    }
}

function generateResourceInfo(stackName: string, environment: string): ResourceInfo {
    const outputs = getStackOutputs(stackName);
    const resources = getStackResources(stackName);
    const region = process.env.AWS_REGION || 'ap-northeast-1';

    const info: ResourceInfo = {
        stackName,
        environment,
        region,
        resources: {},
        tags: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    // VPC情報の収集
    const vpcResource = resources.find((r) => r.ResourceType === 'AWS::EC2::VPC');
    if (vpcResource) {
        info.resources.vpc = {
            vpcId: vpcResource.PhysicalResourceId,
            publicSubnets: [],
            privateSubnets: [],
            isolatedSubnets: [],
        };
    }

    // データベース情報の収集
    const dbResource = resources.find(
        (r) =>
            r.ResourceType === 'AWS::RDS::DBInstance' || r.ResourceType === 'AWS::RDS::DBCluster'
    );
    if (dbResource) {
        info.resources.database = {
            type: dbResource.ResourceType === 'AWS::RDS::DBInstance' ? 'rds' : 'aurora',
            endpoint: outputs.DatabaseEndpoint || '',
            port: parseInt(outputs.DatabasePort || '5432'),
            engine: outputs.DatabaseEngine || 'postgresql',
            version: outputs.DatabaseEngineVersion || '',
        };
    }

    // キャッシュ情報の収集
    const cacheResource = resources.find(
        (r) => r.ResourceType === 'AWS::ElastiCache::CacheCluster'
    );
    if (cacheResource) {
        info.resources.cache = {
            type: 'redis',
            endpoint: outputs.RedisEndpoint || '',
            port: parseInt(outputs.RedisPort || '6379'),
            engine: 'redis',
            version: outputs.RedisEngineVersion || '',
        };
    }

    // S3情報の収集
    const s3Resource = resources.find((r) => r.ResourceType === 'AWS::S3::Bucket');
    if (s3Resource) {
        info.resources.s3 = {
            bucketName: s3Resource.PhysicalResourceId,
            websiteUrl: outputs.BucketWebsiteUrl,
        };
    }

    // CloudFront情報の収集
    const cfResource = resources.find(
        (r) => r.ResourceType === 'AWS::CloudFront::Distribution'
    );
    if (cfResource) {
        info.resources.cloudfront = {
            distributionId: cfResource.PhysicalResourceId,
            domainName: outputs.CloudFrontDomainName || '',
        };
    }

    // WAF情報の収集
    const wafResource = resources.find((r) => r.ResourceType === 'AWS::WAFv2::WebACL');
    if (wafResource) {
        info.resources.waf = {
            webAclId: wafResource.PhysicalResourceId,
            scope: outputs.WafScope || 'REGIONAL',
        };
    }

    return info;
}

function saveResourceInfo(info: ResourceInfo): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dirPath = path.join(process.cwd(), 'resource-info', info.stackName);

    // ディレクトリが存在しない場合は作成
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    // JSON形式で保存
    const jsonPath = path.join(dirPath, `resources-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(info, null, 2));

    // YAML形式で保存（設定ファイル用）
    const configPath = path.join(dirPath, 'config.yml');
    const config = {
        environment: info.environment,
        region: info.region,
        vpc: info.resources.vpc?.vpcId,
        database: {
            endpoint: info.resources.database?.endpoint,
            port: info.resources.database?.port,
        },
        cache: {
            endpoint: info.resources.cache?.endpoint,
            port: info.resources.cache?.port,
        },
        s3: {
            bucket: info.resources.s3?.bucketName,
        },
        cloudfront: {
            domain: info.resources.cloudfront?.domainName,
        },
    };
    fs.writeFileSync(configPath, yaml.stringify(config));

    console.log(`Resource information saved to ${jsonPath}`);
    console.log(`Configuration saved to ${configPath}`);
}

// メイン処理
function main(): void {
    const stackName = process.argv[2];
    const environment = process.argv[3] || 'development';

    if (!stackName) {
        console.error('Stack name is required');
        process.exit(1);
    }

    try {
        const info = generateResourceInfo(stackName, environment);
        saveResourceInfo(info);
    } catch (error) {
        console.error('Error generating resource information:', error);
        process.exit(1);
    }
}

main();