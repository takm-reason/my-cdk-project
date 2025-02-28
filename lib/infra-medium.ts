import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { Construct } from 'constructs';

export class InfraMediumStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Medium環境用のVPC設定
        const vpc = new ec2.Vpc(this, 'MediumVPC', {
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
                {
                    name: 'Database',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                }
            ]
        });

        // Medium環境用のRDSインスタンス
        new rds.DatabaseInstance(this, 'MediumDatabase', {
            engine: rds.DatabaseInstanceEngine.mysql({
                version: rds.MysqlEngineVersion.VER_8_0
            }),
            vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
            allocatedStorage: 50,
            maxAllocatedStorage: 100,
            databaseName: 'appdb',
            multiAz: true,
            deletionProtection: true,
            backupRetention: cdk.Duration.days(14),
        });

        // Medium環境用のAutoScalingGroup
        new autoscaling.AutoScalingGroup(this, 'MediumAppASG', {
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
            machineImage: new ec2.AmazonLinuxImage({
                generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
            }),
            minCapacity: 2,
            maxCapacity: 4,
            desiredCapacity: 2,
            healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.seconds(60) }),
        });
    }
}