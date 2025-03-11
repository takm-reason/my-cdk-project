import * as AWS from 'aws-sdk';

interface ResourceInfoHandlerProps {
    region: string;
    stackName: string;
}

export async function handler(event: any): Promise<any> {
    console.log('Event:', JSON.stringify(event, null, 2));

    const props: ResourceInfoHandlerProps = {
        region: event.ResourceProperties.region,
        stackName: event.ResourceProperties.stackName,
    };

    try {
        switch (event.RequestType) {
            case 'Create':
            case 'Update':
                return await handleCreateOrUpdate(props);
            case 'Delete':
                return await handleDelete();
            default:
                throw new Error(`Unsupported request type: ${event.RequestType}`);
        }
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

async function handleCreateOrUpdate(props: ResourceInfoHandlerProps): Promise<any> {
    const cloudformation = new AWS.CloudFormation({ region: props.region });
    const ec2 = new AWS.EC2({ region: props.region });
    const rds = new AWS.RDS({ region: props.region });
    const s3 = new AWS.S3({ region: props.region });
    const ecs = new AWS.ECS({ region: props.region });

    // スタックの出力を取得
    const stackOutputs = await cloudformation.describeStacks({
        StackName: props.stackName,
    }).promise();

    // スタックのリソースを取得
    const stackResources = await cloudformation.describeStackResources({
        StackName: props.stackName,
    }).promise();

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
                        const vpcDetails = await ec2.describeVpcs({
                            VpcIds: [resource.PhysicalResourceId],
                        }).promise();
                        details = {
                            ...details,
                            ...vpcDetails.Vpcs?.[0],
                        };
                    }
                    break;

                case 'AWS::RDS::DBInstance':
                    if (resource.PhysicalResourceId) {
                        const dbDetails = await rds.describeDBInstances({
                            DBInstanceIdentifier: resource.PhysicalResourceId,
                        }).promise();
                        details = {
                            ...details,
                            ...dbDetails.DBInstances?.[0],
                        };
                    }
                    break;

                case 'AWS::S3::Bucket':
                    if (resource.PhysicalResourceId) {
                        const bucketDetails = await s3.getBucketLocation({
                            Bucket: resource.PhysicalResourceId,
                        }).promise();
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
                        const clusterDetails = await ecs.describeServices({
                            cluster: resource.PhysicalResourceId,
                            services: [resource.PhysicalResourceId],
                        }).promise();
                        details = {
                            ...details,
                            ...clusterDetails.services?.[0],
                        };
                    }
                    break;
            }
        } catch (error) {
            console.warn(`Failed to get details for ${resource.LogicalResourceId}:`, error);
        }

        resourceInfo.resources.push(details);
    }

    return {
        PhysicalResourceId: `${props.stackName}-resource-info`,
        Data: resourceInfo,
    };
}

async function handleDelete(): Promise<any> {
    // 削除時は特に何もする必要がない
    return {
        PhysicalResourceId: 'deleted',
    };
}