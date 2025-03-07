import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ResourceInfoCustomResourceProps {
    region: string;
    stackName: string;
}

export class ResourceInfoCustomResource extends Construct {
    private static handler: lambda.Function;
    public readonly resourceInfo: cdk.CustomResource;

    constructor(scope: Construct, id: string, props: ResourceInfoCustomResourceProps) {
        super(scope, id);

        // Lambda関数は一度だけ作成し、以降は再利用
        if (!ResourceInfoCustomResource.handler) {
            ResourceInfoCustomResource.handler = new lambda.Function(scope, 'SharedResourceInfoHandler', {
                runtime: lambda.Runtime.NODEJS_18_X,
                handler: 'resource-info-handler.handler',
                code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda')),
                timeout: cdk.Duration.minutes(5),
                memorySize: 512,
                environment: {
                    REGION: props.region,
                },
            });

            // 必要なIAMパーミッションを付与
            ResourceInfoCustomResource.handler.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'cloudformation:DescribeStacks',
                    'cloudformation:DescribeStackResources',
                    'cloudformation:ListStackResources',
                    'ec2:DescribeVpcs',
                    'ec2:DescribeSubnets',
                    'rds:DescribeDBInstances',
                    'rds:DescribeDBClusters',
                    's3:GetBucketLocation',
                    'ecs:DescribeClusters',
                    'ecs:DescribeServices',
                    'elasticache:DescribeCacheClusters',
                    'elasticache:DescribeReplicationGroups',
                    'cloudfront:GetDistribution',
                    'wafv2:GetWebACL',
                    'shield:DescribeProtection',
                    'codepipeline:GetPipeline',
                    'cloudwatch:GetDashboard',
                    'ssm:GetParameter'
                ],
                resources: ['*'],  // 本番環境では必要に応じてリソースを制限
            }));
        }

        // CustomResourceの作成（各インスタンスで個別に作成）
        this.resourceInfo = new cdk.CustomResource(this, 'ResourceInfo', {
            serviceToken: ResourceInfoCustomResource.handler.functionArn,
            properties: {
                region: props.region,
                stackName: props.stackName,
                timestamp: new Date().toISOString(), // 強制的な更新のためのタイムスタンプ
            },
        });

        // 出力の設定
        new cdk.CfnOutput(this, 'ResourceInformation', {
            value: this.resourceInfo.getAtt('Data').toString(),
            description: 'Detailed resource information after deployment',
        });
    }

    public getResourceInfo(): any {
        return this.resourceInfo.getAtt('Data');
    }
}