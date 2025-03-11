#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface ResourceInfo {
    projectName: string;
    timestamp: string;
    resources: Resource[];
    outputs: any[];
}

interface Resource {
    resourceType: string;
    resourceId: string;
    properties: {
        [key: string]: any;
    };
}

interface CloudFormationResource {
    LogicalResourceId: string;
    PhysicalResourceId: string;
    ResourceType: string;
    ResourceStatus: string;
}

interface CloudFormationOutput {
    OutputKey: string;
    OutputValue: string;
    Description?: string;
}

async function getLatestResourceFile(directory: string): Promise<string> {
    try {
        const files = fs.readdirSync(directory)
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(directory, file));

        if (files.length === 0) {
            throw new Error('リソース情報ファイルが見つかりません');
        }

        return files.reduce((latest, current) => {
            const latestStat = fs.statSync(latest);
            const currentStat = fs.statSync(current);
            return currentStat.mtime > latestStat.mtime ? current : latest;
        });
    } catch (error: any) {
        console.error(`エラー: ${error?.message || '不明なエラーが発生しました'}`);
        process.exit(1);
    }
}

function loadResourceInfo(filePath: string): ResourceInfo {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error: any) {
        console.error(`ファイルの読み込みエラー: ${error?.message || '不明なエラーが発生しました'}`);
        process.exit(1);
    }
}

async function getCloudFormationResources(stackName: string): Promise<CloudFormationResource[]> {
    try {
        const command = `aws cloudformation describe-stack-resources --stack-name ${stackName}`;
        const output = execSync(command, { encoding: 'utf-8' });
        const result = JSON.parse(output);
        return result.StackResources;
    } catch (error: any) {
        console.error(`CloudFormationリソース取得エラー: ${error?.message || '不明なエラーが発生しました'}`);
        return [];
    }
}

async function getCloudFormationOutputs(stackName: string): Promise<CloudFormationOutput[]> {
    try {
        const command = `aws cloudformation describe-stacks --stack-name ${stackName}`;
        const output = execSync(command, { encoding: 'utf-8' });
        const result = JSON.parse(output);
        return result.Stacks[0].Outputs || [];
    } catch (error: any) {
        console.error(`CloudFormationアウトプット取得エラー: ${error?.message || '不明なエラーが発生しました'}`);
        return [];
    }
}

async function getVpcSubnets(vpcId: string): Promise<any> {
    try {
        const command = `aws ec2 describe-subnets --filters "Name=vpc-id,Values=${vpcId}"`;
        const output = execSync(command, { encoding: 'utf-8' });
        const result = JSON.parse(output);
        return result.Subnets;
    } catch (error) {
        return null;
    }
}

async function getAwsResourceDetails(resourceType: string, physicalId: string, cfnResources: CloudFormationResource[]): Promise<any> {
    try {
        let command: string;
        switch (resourceType) {
            case 'VPC': {
                command = `aws ec2 describe-vpcs --vpc-ids ${physicalId}`;
                const vpcInfo = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                const subnets = await getVpcSubnets(physicalId);

                const publicSubnets = subnets
                    .filter((s: any) => s.MapPublicIpOnLaunch)
                    .map((s: any) => ({
                        id: s.SubnetId,
                        availabilityZone: s.AvailabilityZone,
                        cidr: s.CidrBlock
                    }));

                const privateSubnets = subnets
                    .filter((s: any) => !s.MapPublicIpOnLaunch)
                    .map((s: any) => ({
                        id: s.SubnetId,
                        availabilityZone: s.AvailabilityZone,
                        cidr: s.CidrBlock
                    }));

                return {
                    vpcId: physicalId,
                    vpcCidr: vpcInfo.Vpcs[0].CidrBlock,
                    publicSubnets,
                    privateSubnets
                };
            }
            case 'RDS': {
                command = `aws rds describe-db-instances --db-instance-identifier ${physicalId}`;
                const dbInfo = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                return {
                    instanceIdentifier: physicalId,
                    databaseName: dbInfo.DBInstances[0].DBName || 'postgres',
                    endpointAddress: dbInfo.DBInstances[0].Endpoint.Address,
                    port: dbInfo.DBInstances[0].Endpoint.Port
                };
            }
            case 'S3': {
                command = `aws s3api get-bucket-location --bucket ${physicalId}`;
                const s3Info = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                const region = s3Info.LocationConstraint || 'us-east-1';
                return {
                    bucketName: physicalId,
                    bucketArn: `arn:aws:s3:::${physicalId}`,
                    bucketDomainName: `${physicalId}.s3.amazonaws.com`,
                    bucketWebsiteUrl: `http://${physicalId}.s3-website-${region}.amazonaws.com`
                };
            }
            case 'ECS': {
                command = `aws ecs describe-clusters --clusters ${physicalId}`;
                const ecsInfo = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                const cluster = ecsInfo.clusters[0];

                // サービス情報を取得
                const serviceResource = cfnResources.find(r => r.ResourceType === 'AWS::ECS::Service');
                const taskDefResource = cfnResources.find(r => r.ResourceType === 'AWS::ECS::TaskDefinition');

                return {
                    clusterName: cluster.clusterName,
                    clusterArn: cluster.clusterArn,
                    serviceArn: serviceResource?.PhysicalResourceId,
                    taskDefinitionArn: taskDefResource?.PhysicalResourceId
                };
            }
            default:
                return null;
        }
    } catch (error) {
        return null;
    }
}

async function resolveTokens(resource: Resource, cfnOutputs: CloudFormationOutput[], cfnResources: CloudFormationResource[]): Promise<Resource> {
    const resolvedProperties: { [key: string]: any } = { ...resource.properties };
    const cfnResource = cfnResources.find(r => r.LogicalResourceId === resource.resourceId || r.LogicalResourceId.includes(resource.resourceId));

    if (cfnResource) {
        const resourceDetails = await getAwsResourceDetails(resource.resourceType, cfnResource.PhysicalResourceId, cfnResources);
        if (resourceDetails) {
            Object.assign(resolvedProperties, resourceDetails);
        }
    }

    // Load Balancer DNSの解決
    if (resolvedProperties.loadBalancerDns && resolvedProperties.loadBalancerDns.includes('${Token[')) {
        const lbOutput = cfnOutputs.find(o => o.OutputKey === 'LoadBalancerDNS');
        if (lbOutput) {
            resolvedProperties.loadBalancerDns = lbOutput.OutputValue;
        }
    }

    return {
        ...resource,
        properties: resolvedProperties
    };
}

function formatResourceInfo(resource: Resource, cfnResource?: CloudFormationResource): string {
    const output: string[] = [];
    output.push(`リソースタイプ: ${resource.resourceType}`);
    output.push(`リソースID: ${resource.resourceId}`);

    if (cfnResource) {
        output.push(`物理ID: ${cfnResource.PhysicalResourceId}`);
        output.push(`ステータス: ${cfnResource.ResourceStatus}`);
    }

    output.push('プロパティ:');

    Object.entries(resource.properties).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            output.push(`  ${key}:`);
            value.forEach(item => {
                if (typeof item === 'object') {
                    Object.entries(item).forEach(([k, v]) => {
                        output.push(`    - ${k}: ${v}`);
                    });
                } else {
                    output.push(`    - ${item}`);
                }
            });
        } else if (typeof value === 'object') {
            output.push(`  ${key}:`);
            Object.entries(value).forEach(([k, v]) => {
                output.push(`    ${k}: ${v}`);
            });
        } else {
            output.push(`  ${key}: ${value}`);
        }
    });

    return output.join('\n');
}

function getAwsResourceType(resourceType: string): string {
    switch (resourceType) {
        case 'AWS::EC2::VPC':
            return 'VPC';
        case 'AWS::RDS::DBInstance':
            return 'RDS';
        case 'AWS::S3::Bucket':
            return 'S3';
        case 'AWS::ECS::Cluster':
            return 'ECS';
        default:
            return '';
    }
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('project', {
            type: 'string',
            description: 'プロジェクト名でフィルタ',
        })
        .option('type', {
            type: 'string',
            description: 'リソースタイプでフィルタ (VPC, RDS, S3, ECS)',
            choices: ['VPC', 'RDS', 'S3', 'ECS'],
        })
        .argv;

    const resourceInfoDir = path.join(process.cwd(), 'resource-info');
    const latestFile = await getLatestResourceFile(resourceInfoDir);
    const data = loadResourceInfo(latestFile);

    console.log('=== リソース情報 ===');
    console.log(`プロジェクト名: ${data.projectName}`);
    console.log(`タイムスタンプ: ${data.timestamp}`);
    console.log('==================\n');

    // CloudFormationスタックのリソースとアウトプット情報を取得
    const stackName = `${data.projectName}-development-small`;
    const cfnResources = await getCloudFormationResources(stackName);
    const cfnOutputs = await getCloudFormationOutputs(stackName);

    for (const resource of data.resources) {
        if (argv.project && argv.project !== data.projectName) continue;
        if (argv.type && argv.type !== resource.resourceType) continue;

        // CloudFormationリソースを検索
        const cfnResource = cfnResources.find(r => {
            const awsType = getAwsResourceType(r.ResourceType);
            return awsType === resource.resourceType &&
                (r.LogicalResourceId === resource.resourceId ||
                    r.LogicalResourceId.includes(resource.resourceId));
        });

        // トークンを実際の値に解決
        const resolvedResource = await resolveTokens(resource, cfnOutputs, cfnResources);

        console.log(formatResourceInfo(resolvedResource, cfnResource));
        console.log('-'.repeat(50));

        if (cfnResource) {
            const awsInfo = await getAwsResourceDetails(
                resource.resourceType,
                cfnResource.PhysicalResourceId,
                cfnResources
            );
            if (awsInfo) {
                console.log('AWS上の実際のリソース情報:');
                console.log(JSON.stringify(awsInfo, null, 2));
                console.log('-'.repeat(50));
            }
        }
    }
}

main().catch(error => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
});