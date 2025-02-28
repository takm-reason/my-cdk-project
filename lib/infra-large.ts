import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export class InfraLargeStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Large環境用のVPC設定
        const vpc = new ec2.Vpc(this, 'LargeVPC', {
            maxAzs: 3,
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

        // Large環境用のRDSインスタンス
        new rds.DatabaseInstance(this, 'LargeDatabase', {
            engine: rds.DatabaseInstanceEngine.mysql({
                version: rds.MysqlEngineVersion.VER_8_0
            }),
            vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
            allocatedStorage: 100,
            maxAllocatedStorage: 500,
            databaseName: 'appdb',
            multiAz: true,
            deletionProtection: true,
            backupRetention: cdk.Duration.days(30),
            performanceInsightRetention: rds.PerformanceInsightRetention.LONG_TERM,
            monitoringInterval: cdk.Duration.seconds(30),
        });

        // Large環境用のApplication Load Balancer
        const alb = new elbv2.ApplicationLoadBalancer(this, 'LargeALB', {
            vpc,
            internetFacing: true,
        });

        // Large環境用のAutoScalingGroup
        const asg = new autoscaling.AutoScalingGroup(this, 'LargeAppASG', {
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.C6G, ec2.InstanceSize.LARGE),
            machineImage: new ec2.AmazonLinuxImage({
                generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
            }),
            minCapacity: 3,
            maxCapacity: 10,
            desiredCapacity: 3,
            healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.seconds(60) }),
        });

        // ALBリスナーとターゲットグループの設定
        const listener = alb.addListener('Listener', {
            port: 80,
        });

        listener.addTargets('Fleet', {
            port: 80,
            targets: [asg],
            healthCheck: {
                path: '/health',
                unhealthyThresholdCount: 2,
                healthyThresholdCount: 5,
                interval: cdk.Duration.seconds(30),
            },
        });
    }
}