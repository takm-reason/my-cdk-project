import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cdk from 'aws-cdk-lib';
import { BaseResourceBuilder } from '../core/stack-builder';
import { VpcConfig } from '../interfaces/config';
import { ConfigValidator } from '../helpers/validators';

export class VpcBuilder extends BaseResourceBuilder<ec2.Vpc, VpcConfig> {
    validate(): boolean {
        return ConfigValidator.validateVpcConfig(this.config);
    }

    build(): ec2.Vpc {
        const vpc = new ec2.Vpc(this.scope, this.generateName('vpc'), {
            maxAzs: this.config.maxAzs,
            natGateways: this.config.natGateways,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 24,
                    name: 'Isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                }
            ],
            gatewayEndpoints: {
                S3: {
                    service: ec2.GatewayVpcEndpointAwsService.S3
                }
            }
        });

        // VPCフローログの有効化（CloudWatchLogsに出力）
        vpc.addFlowLog('FlowLog', {
            destination: ec2.FlowLogDestination.toCloudWatchLogs(),
            trafficType: ec2.FlowLogTrafficType.ALL
        });

        // タグの追加
        this.addTags(vpc);

        return vpc;
    }
}