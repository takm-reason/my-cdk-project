import { Context } from 'aws-lambda';
import * as https from 'https';
import * as url from 'url';
import {
    CloudFormationClient,
    DescribeStacksCommand,
    DescribeStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import { EC2Client, DescribeVpcsCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { S3Client, GetBucketLocationCommand } from '@aws-sdk/client-s3';
import { ECSClient, DescribeServicesCommand, ListServicesCommand } from '@aws-sdk/client-ecs';

interface ResourceInfoHandlerProps {
    region: string;
    stackName: string;
}

async function sendResponse(event: any, context: Context, responseStatus: 'SUCCESS' | 'FAILED', responseData: any, physicalResourceId?: string) {
    const responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
        PhysicalResourceId: physicalResourceId || context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        NoEcho: false,
        Data: responseData
    });

    console.log('Response body:', responseBody);

    const parsedUrl = url.parse(event.ResponseURL);
    if (!parsedUrl.hostname) {
        throw new Error(`Invalid ResponseURL: ${event.ResponseURL}`);
    }

    const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: 'PUT',
        headers: {
            'content-type': '',
            'content-length': responseBody.length
        }
    };

    return new Promise((resolve, reject) => {
        const request = https.request(options, (response) => {
            console.log(`Status code: ${response.statusCode}`);
            console.log(`Status message: ${response.statusMessage}`);
            response.on('data', () => { }); // ストリームを消費
            response.on('end', () => {
                console.log('Successfully sent response to CloudFormation');
                resolve(undefined);
            });
        });

        request.on('error', (error) => {
            console.error('Failed to send response to CloudFormation:', error);
            reject(error);
        });

        request.write(responseBody);
        request.end();
    });
}

async function handleCreateOrUpdate(props: ResourceInfoHandlerProps): Promise<any> {
    console.log('Starting handleCreateOrUpdate with props:', props);
    const cloudformation = new CloudFormationClient({ region: props.region });
    const ec2 = new EC2Client({ region: props.region });
    const rds = new RDSClient({ region: props.region });
    const s3 = new S3Client({ region: props.region });
    const ecs = new ECSClient({ region: props.region });

    try {
        // スタックの出力を取得
        const stackOutputs = await cloudformation.send(new DescribeStacksCommand({
            StackName: props.stackName
        }));

        // スタックのリソースを取得
        const stackResources = await cloudformation.send(new DescribeStackResourcesCommand({
            StackName: props.stackName
        }));

        const resourceInfo: any = {
            stackOutputs: stackOutputs.Stacks?.[0].Outputs || [],
            resources: [],
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
                                // まずサービス一覧を取得
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
            } catch (error) {
                console.warn(`Failed to get details for ${resource.LogicalResourceId}:`, error);
                // エラーがあってもリソース情報は追加
                details.error = `Failed to get details: ${error.message}`;
            }

            resourceInfo.resources.push(details);
        }

        console.log('Successfully gathered resource information');
        return {
            PhysicalResourceId: `${props.stackName}-resource-info`,
            Data: resourceInfo,
        };
    } catch (error) {
        console.error('Error in handleCreateOrUpdate:', error);
        throw error;
    }
}

async function handleDelete(): Promise<any> {
    // 削除時は最小限の情報を返す
    return {
        PhysicalResourceId: 'deleted',
        Data: {},
    };
}

export async function handler(event: any, context: Context): Promise<void> {
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('Context:', JSON.stringify({
        logGroupName: context.logGroupName,
        logStreamName: context.logStreamName,
        functionName: context.functionName,
        awsRequestId: context.awsRequestId,
    }, null, 2));

    try {
        const props: ResourceInfoHandlerProps = {
            region: event.ResourceProperties.region,
            stackName: event.ResourceProperties.stackName,
        };

        let responseData: any;
        let physicalResourceId: string;

        switch (event.RequestType) {
            case 'Create':
            case 'Update':
                const result = await handleCreateOrUpdate(props);
                responseData = result.Data;
                physicalResourceId = result.PhysicalResourceId;
                await sendResponse(event, context, 'SUCCESS', responseData, physicalResourceId);
                break;

            case 'Delete':
                console.log('Processing Delete request');
                const deleteResult = await handleDelete();
                console.log('Delete result:', deleteResult);
                await sendResponse(event, context, 'SUCCESS', deleteResult.Data, deleteResult.PhysicalResourceId);
                break;

            default:
                throw new Error(`Unsupported request type: ${event.RequestType}`);
        }
    } catch (error) {
        console.error('Error:', error);
        await sendResponse(event, context, 'FAILED', { Error: error.message });
    }
}