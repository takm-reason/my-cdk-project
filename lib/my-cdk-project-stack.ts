import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MyCdkProjectStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ここにAWSリソースの定義を追加
        // 例: S3バケット
        // new s3.Bucket(this, 'MyBucket', {
        //   bucketName: 'my-example-bucket'
        // });
    }
}