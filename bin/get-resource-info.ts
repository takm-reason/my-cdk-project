#!/usr/bin/env node
import { Command } from 'commander';
import {
    CloudFormationClient,
    DescribeStacksCommand,
    DescribeStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import { EC2Client, DescribeVpcsCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { S3Client, GetBucketLocationCommand } from '@aws-sdk/client-s3';
import { ECSClient, DescribeServicesCommand, ListServicesCommand } from '@aws-sdk/client-ecs';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import * as fs from 'fs';
import * as path from 'path';

interface ResourceInfo {
    stackOutputs: any[];
    resources: any[];
    timestamp: string;
    environment: string;
}

async function getResourceInfo(stackName: string, region: string): Promise<ResourceInfo> {
    console.log(`Getting resource information for stack: ${stackName} in region: ${region}`);

    const cloudformation = new CloudFormationClient({ region });
    const ec2 = new EC2Client({ region });
    const rds = new RDSClient({ region });
    const s3 = new S3Client({ region });
    const ecs = new ECSClient({ region });

    // スタックの出力を取得
    const stackOutputs = await cloudformation.send(new DescribeStacksCommand({
        StackName: stackName
    }));

    // スタックのリソースを取得
    const stackResources = await cloudformation.send(new DescribeStackResourcesCommand({
        StackName: stackName
    }));

    const resourceInfo: ResourceInfo = {
        stackOutputs: stackOutputs.Stacks?.[0].Outputs || [],
        resources: [],
        timestamp: new Date().toISOString(),
        environment: process.env.ENVIRONMENT || 'development'
    };

    // 各リソースの詳細情報を取得
    for (const resource of stackResources.StackResources || []) {
        let details: any = {
            logicalId: resource.LogicalResourceId,
            physicalId: resource.PhysicalResourceId,
            type: resource.ResourceType,
            status: resource.ResourceStatus,
        };

        try {
            switch (resource.ResourceType) {
                case 'AWS::EC2::VPC':
                    if (resource.PhysicalResourceId) {
                        const vpcDetails = await ec2.send(new DescribeVpcsCommand({
                            VpcIds: [resource.PhysicalResourceId],
                        }));
                        details = {
                            ...details,
                            ...vpcDetails.Vpcs?.[0],
                        };
                    }
                    break;

                case 'AWS::RDS::DBInstance':
                    if (resource.PhysicalResourceId) {
                        const dbDetails = await rds.send(new DescribeDBInstancesCommand({
                            DBInstanceIdentifier: resource.PhysicalResourceId,
                        }));
                        details = {
                            ...details,
                            ...dbDetails.DBInstances?.[0],
                        };
                    }
                    break;

                case 'AWS::S3::Bucket':
                    if (resource.PhysicalResourceId) {
                        const bucketDetails = await s3.send(new GetBucketLocationCommand({
                            Bucket: resource.PhysicalResourceId,
                        }));
                        details = {
                            ...details,
                            name: resource.PhysicalResourceId,
                            location: bucketDetails.LocationConstraint,
                            arn: `arn:aws:s3:::${resource.PhysicalResourceId}`,
                        };
                    }
                    break;

                case 'AWS::ECS::Cluster':
                    if (resource.PhysicalResourceId) {
                        try {
                            const listServicesResponse = await ecs.send(new ListServicesCommand({
                                cluster: resource.PhysicalResourceId
                            }));

                            if (listServicesResponse.serviceArns && listServicesResponse.serviceArns.length > 0) {
                                const clusterDetails = await ecs.send(new DescribeServicesCommand({
                                    cluster: resource.PhysicalResourceId,
                                    services: listServicesResponse.serviceArns
                                }));
                                details = {
                                    ...details,
                                    services: clusterDetails.services,
                                };
                            }
                        } catch (error) {
                            console.warn(`Failed to get ECS services for cluster ${resource.PhysicalResourceId}:`, error);
                        }
                    }
                    break;
            }
        } catch (error: any) {
            console.warn(`Failed to get details for ${resource.LogicalResourceId}:`, error);
            details.error = `Failed to get details: ${error?.message || 'Unknown error'}`;
        }

        resourceInfo.resources.push(details);
    }

    return resourceInfo;
}

async function saveToFile(info: ResourceInfo, projectName: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${projectName}-${timestamp}.json`;
    const filePath = path.join(process.cwd(), 'resource-info', fileName);

    // ディレクトリが存在しない場合は作成
    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(info, null, 2));
    console.log(`Resource information saved to: ${filePath}`);
}

async function saveToSSM(info: ResourceInfo, projectName: string, environment: string) {
    const ssm = new SSMClient({ region: process.env.AWS_REGION });
    const parameterName = `/aws/cdk/${projectName}/${environment}/resource-info`;

    await ssm.send(new PutParameterCommand({
        Name: parameterName,
        Value: JSON.stringify(info),
        Type: 'String',
        Overwrite: true,
    }));

    console.log(`Resource information saved to SSM parameter: ${parameterName}`);
}

async function main() {
    const program = new Command();

    program
        .name('get-resource-info')
        .description('Get AWS resource information for a CDK stack')
        .requiredOption('-p, --project <name>', 'Project name')
        .requiredOption('-s, --stack <name>', 'Stack name')
        .option('-r, --region <region>', 'AWS region', process.env.AWS_REGION)
        .option('-e, --environment <env>', 'Environment (development/staging/production)', 'development')
        .parse(process.argv);

    const options = program.opts();
    process.env.ENVIRONMENT = options.environment;

    try {
        const info = await getResourceInfo(options.stack, options.region);

        if (options.environment === 'development') {
            await saveToFile(info, options.project);
        } else {
            await saveToSSM(info, options.project, options.environment);
            console.log('For production environments, resource information is stored in SSM Parameter Store');
        }
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();