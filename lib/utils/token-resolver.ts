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
    private region: string;
    private accountId: string;

    constructor(stackName: string) {
        this.stackName = stackName;
        this.cfnOutputs = [];
        this.cfnResources = [];
        this.region = process.env.AWS_REGION || 'ap-northeast-1';
        this.accountId = '';
    }

    /**
     * ARNを構築
     */
    private constructArn(resourceType: string, physicalId: string): string {
        switch (resourceType) {
            case 'RDS':
                return `arn:aws:rds:${this.region}:${this.accountId}:db:${physicalId}`;
            case 'S3':
                return `arn:aws:s3:::${physicalId}`;
            case 'ECS':
                return `arn:aws:ecs:${this.region}:${this.accountId}:cluster/${physicalId}`;
            default:
                return '';
        }
    }

    /**
     * AWSアカウントIDを取得
     */
    private async getAccountId(): Promise<string> {
        try {
            const command = 'aws sts get-caller-identity --query Account --output text';
            return execSync(command, { encoding: 'utf-8' }).trim();
        } catch (error) {
            console.error('アカウントID取得エラー:', error);
            return '';
        }
    }

    /**
     * CloudFormationスタックの情報を初期化
     */
    async initialize(): Promise<void> {
        this.cfnResources = await this.getCloudFormationResources();
        this.cfnOutputs = await this.getCloudFormationOutputs();
        this.accountId = await this.getAccountId();
    }

    /**
     * ECSサービスの詳細情報を取得
     */
    private async getEcsServiceDetails(clusterName: string, serviceArn: string): Promise<any> {
        try {
            const command = `aws ecs describe-services --cluster ${clusterName} --services ${serviceArn}`;
            const serviceInfo = JSON.parse(execSync(command, { encoding: 'utf-8' }));
            const service = serviceInfo.services[0];

            // タスク定義の詳細を取得
            const taskDefCommand = `aws ecs describe-task-definition --task-definition ${service.taskDefinition}`;
            const taskDefInfo = JSON.parse(execSync(taskDefCommand, { encoding: 'utf-8' }));
            const taskDef = taskDefInfo.taskDefinition;

            return {
                name: service.serviceName,
                arn: service.serviceArn,
                status: service.status,
                desiredCount: service.desiredCount,
                runningCount: service.runningCount,
                taskDefinition: {
                    family: taskDef.family,
                    arn: taskDef.taskDefinitionArn,
                    cpu: taskDef.cpu,
                    container: taskDef.containerDefinitions[0]
                }
            };
        } catch (error) {
            console.error('ECSサービス詳細取得エラー:', error);
            return null;
        }
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
            let details: any = {};

            // 基本情報を設定
            details.physicalId = physicalId;
            details.arn = this.constructArn(resourceType, physicalId);

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
                        const serviceDetails = await this.getEcsServiceDetails(physicalId, serviceResource.PhysicalResourceId);
                        if (serviceDetails) {
                            return {
                                cluster: {
                                    name: cluster.clusterName,
                                    arn: cluster.clusterArn
                                },
                                service: serviceDetails,
                                physicalId: physicalId,
                                arn: cluster.clusterArn
                            };
                        }
                    }

                    return {
                        cluster: {
                            name: cluster.clusterName,
                            arn: cluster.clusterArn
                        },
                        physicalId: physicalId,
                        arn: cluster.clusterArn
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
            if (value === null) {
                result[key] = null;
            } else if (value === '[object Object]') {
                result[key] = {};
            } else if (typeof value === 'object') {
                const resolvedObj = this.resolvePropertyTokens(value);
                if (Object.keys(resolvedObj).length === 0) {
                    result[key] = {};
                } else {
                    result[key] = resolvedObj;
                }
            } else {
                const resolvedValue = this.resolveSingleToken(value);
                if (resolvedValue && typeof resolvedValue === 'string' && resolvedValue.includes('${Token[')) {
                    // トークンが解決できなかった場合、CloudFormation出力から探す
                    const tokenValue = this.findValueInOutputs(resolvedValue);
                    result[key] = tokenValue || resolvedValue;
                } else {
                    result[key] = resolvedValue;
                }
            }
        }
        return result;
    }

    /**
     * CloudFormation出力値からトークンの値を探す
     */
    private findValueInOutputs(token: string): string | null {
        const tokenKey = token.match(/\${Token\[([^\]]+)\]}/)?.[1];
        if (!tokenKey) return null;

        // 出力値を検索
        const output = this.cfnOutputs.find(o =>
            o.OutputKey.includes(tokenKey) ||
            o.OutputValue?.includes(tokenKey)
        );

        return output?.OutputValue || null;
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