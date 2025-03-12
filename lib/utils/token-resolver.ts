import { execSync } from 'child_process';

export interface CloudFormationOutput {
    OutputKey: string;
    OutputValue: string;
    Description?: string;
}

export interface CloudFormationResource {
    LogicalResourceId: string;
    PhysicalResourceId: string;
    ResourceType: string;
    ResourceStatus: string;
}

export class TokenResolver {
    private cfnOutputs: CloudFormationOutput[];
    private cfnResources: CloudFormationResource[];
    private stackName: string;

    constructor(stackName: string) {
        this.stackName = stackName;
        this.cfnOutputs = [];
        this.cfnResources = [];
    }

    /**
     * CloudFormationスタックの情報を初期化
     */
    async initialize(): Promise<void> {
        this.cfnResources = await this.getCloudFormationResources();
        this.cfnOutputs = await this.getCloudFormationOutputs();
    }

    /**
     * CloudFormationリソース情報を取得
     */
    private async getCloudFormationResources(): Promise<CloudFormationResource[]> {
        try {
            const command = `aws cloudformation describe-stack-resources --stack-name ${this.stackName}`;
            const output = execSync(command, { encoding: 'utf-8' });
            const result = JSON.parse(output);
            return result.StackResources;
        } catch (error: any) {
            console.error(`CloudFormationリソース取得エラー: ${error?.message || '不明なエラーが発生しました'}`);
            return [];
        }
    }

    /**
     * CloudFormationアウトプット情報を取得
     */
    private async getCloudFormationOutputs(): Promise<CloudFormationOutput[]> {
        try {
            const command = `aws cloudformation describe-stacks --stack-name ${this.stackName}`;
            const output = execSync(command, { encoding: 'utf-8' });
            const result = JSON.parse(output);
            return result.Stacks[0].Outputs || [];
        } catch (error: any) {
            console.error(`CloudFormationアウトプット取得エラー: ${error?.message || '不明なエラーが発生しました'}`);
            return [];
        }
    }

    /**
     * AWS リソース固有の詳細情報を取得
     */
    private async getAwsResourceDetails(resourceType: string, physicalId: string): Promise<any> {
        try {
            let command: string;
            switch (resourceType) {
                case 'VPC': {
                    command = `aws ec2 describe-vpcs --vpc-ids ${physicalId}`;
                    const vpcInfo = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                    const subnets = await this.getVpcSubnets(physicalId);

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
                        endpoint: {
                            address: dbInfo.DBInstances[0].Endpoint.Address,
                            port: dbInfo.DBInstances[0].Endpoint.Port
                        }
                    };
                }
                case 'S3': {
                    command = `aws s3api get-bucket-location --bucket ${physicalId}`;
                    const s3Info = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                    const region = s3Info.LocationConstraint || 'us-east-1';
                    return {
                        bucket: {
                            name: physicalId,
                            region: region,
                            domainName: `${physicalId}.s3.amazonaws.com`
                        },
                        endpoints: {
                            s3: `https://s3.${region}.amazonaws.com/${physicalId}`,
                            website: `http://${physicalId}.s3-website-${region}.amazonaws.com`
                        }
                    };
                }
                case 'CloudFront': {
                    command = `aws cloudfront get-distribution --id ${physicalId}`;
                    const distInfo = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                    return {
                        distribution: {
                            id: physicalId,
                            domainName: distInfo.Distribution.DomainName,
                            status: distInfo.Distribution.Status
                        }
                    };
                }
                case 'ECS': {
                    command = `aws ecs describe-clusters --clusters ${physicalId}`;
                    const ecsInfo = JSON.parse(execSync(command, { encoding: 'utf-8' }));
                    const cluster = ecsInfo.clusters[0];

                    // サービス情報を取得
                    const serviceResource = this.cfnResources.find(r => r.ResourceType === 'AWS::ECS::Service');
                    if (serviceResource) {
                        const serviceCommand = `aws ecs describe-services --cluster ${physicalId} --services ${serviceResource.PhysicalResourceId}`;
                        const serviceInfo = JSON.parse(execSync(serviceCommand, { encoding: 'utf-8' }));
                        const service = serviceInfo.services[0];

                        return {
                            cluster: {
                                name: cluster.clusterName,
                                arn: cluster.clusterArn
                            },
                            service: {
                                name: service.serviceName,
                                arn: service.serviceArn,
                                status: service.status,
                                desiredCount: service.desiredCount,
                                runningCount: service.runningCount
                            }
                        };
                    }
                    return {
                        cluster: {
                            name: cluster.clusterName,
                            arn: cluster.clusterArn
                        }
                    };
                }
                default:
                    return null;
            }
        } catch (error) {
            return null;
        }
    }

    /**
     * VPCのサブネット情報を取得
     */
    private async getVpcSubnets(vpcId: string): Promise<any[]> {
        try {
            const command = `aws ec2 describe-subnets --filters "Name=vpc-id,Values=${vpcId}"`;
            const output = execSync(command, { encoding: 'utf-8' });
            const result = JSON.parse(output);
            return result.Subnets;
        } catch (error) {
            return [];
        }
    }

    /**
     * トークンを実際の値に解決
     */
    public async resolveTokens<T extends object>(resource: T): Promise<T> {
        const resolvedResource = { ...resource };

        // CloudFormationリソースを検索
        const cfnResource = this.cfnResources.find(r =>
            r.LogicalResourceId === (resource as any).resourceId ||
            r.LogicalResourceId.includes((resource as any).resourceId)
        );

        if (cfnResource) {
            const resourceDetails = await this.getAwsResourceDetails(
                (resource as any).resourceType,
                cfnResource.PhysicalResourceId
            );
            if (resourceDetails) {
                // 既存のプロパティを保持しながら、新しい情報で更新
                (resolvedResource as any).properties = {
                    ...(resolvedResource as any).properties,
                    ...resourceDetails
                };
            }
        }

        // プロパティ内のトークンを解決
        if ((resolvedResource as any).properties) {
            (resolvedResource as any).properties = this.resolvePropertyTokens(
                (resolvedResource as any).properties
            );
        }

        return resolvedResource;
    }

    /**
     * オブジェクト内のトークンを再帰的に解決
     */
    private resolvePropertyTokens(obj: any): any {
        if (typeof obj !== 'object' || obj === null) {
            return this.resolveSingleToken(obj);
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.resolvePropertyTokens(item));
        }

        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = this.resolvePropertyTokens(value);
        }
        return result;
    }

    /**
     * 単一のトークンを解決
     */
    private resolveSingleToken(value: any): any {
        if (typeof value !== 'string') {
            return value;
        }

        // トークンパターンの検出
        const tokenMatch = value.match(/\${Token\[([^\]]+)\]}/);
        if (!tokenMatch) {
            return value;
        }

        // CloudFormation Outputsから値を探す
        const output = this.cfnOutputs.find(o => o.OutputValue === value || o.OutputKey === tokenMatch[1]);
        if (output) {
            return output.OutputValue;
        }

        // リソースのPhysicalIdから値を探す
        const resource = this.cfnResources.find(r => r.LogicalResourceId === tokenMatch[1]);
        if (resource) {
            return resource.PhysicalResourceId;
        }

        return value;
    }
}