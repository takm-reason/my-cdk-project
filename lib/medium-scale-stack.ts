import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MediumScaleStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 中規模構成のリソースをここに定義
    }
}