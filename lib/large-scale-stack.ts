import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class LargeScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 大規模構成のリソースをここに定義
    }
}