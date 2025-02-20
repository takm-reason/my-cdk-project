import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MyCdkProjectStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ここにAWSリソースを定義します
        // 例:
        // const vpc = new ec2.Vpc(this, 'MyVpc', {
        //   maxAzs: 2
        // });
    }
}
