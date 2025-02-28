import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { SmallScaleStack } from "../lib/small-scale-stack";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";

// 基本的なモック
const mockVpc = {
    vpcId: "mock-vpc-id",
    publicSubnets: [{ subnetId: "mock-subnet-1" }],
    privateSubnets: [{ subnetId: "mock-subnet-2" }],
    node: { id: "mock-vpc" },
    addDependency: jest.fn(),
};

// テスト用のスタック作成
const testApp = new cdk.App();
const testStack = new cdk.Stack(testApp, "TestStack");

// データベースインスタンスの作成
const mockDb = new rds.DatabaseInstance(testStack, "MockDb", {
    engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
    }),
    vpc: new ec2.Vpc(testStack, "MockVpc"),
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
});

// モックの設定
jest.mock("../lib/utils/builders/vpc-builder", () => ({
    VpcBuilder: jest.fn().mockImplementation(() => ({
        build: jest.fn().mockReturnValue(mockVpc),
    })),
}));

jest.mock("../lib/utils/builders/db-builder", () => ({
    DbBuilder: jest.fn().mockImplementation(() => ({
        build: jest.fn().mockReturnValue(mockDb),
    })),
}));

jest.mock("../lib/utils/builders/cache-builder", () => ({
    CacheBuilder: jest.fn().mockImplementation(() => ({
        build: jest.fn().mockReturnValue({
            attrRedisEndpointAddress: "mock-redis",
            attrRedisEndpointPort: "6379",
            node: { id: "mock-redis" },
            addDependency: jest.fn(),
        }),
    })),
}));

jest.mock("../lib/utils/builders/ecs-builder", () => ({
    EcsBuilder: jest.fn().mockImplementation(() => ({
        build: jest.fn().mockReturnValue({
            cluster: {
                clusterName: "mock-cluster",
                node: { id: "mock-cluster" },
                addDependency: jest.fn(),
            },
        }),
    })),
}));

jest.mock("../lib/utils/core/resource-recorder", () => ({
    ResourceRecorder: jest.fn().mockImplementation(() => ({
        recordVpc: jest.fn(),
        recordRds: jest.fn(),
        recordS3: jest.fn(),
        recordEcs: jest.fn(),
        recordElastiCache: jest.fn(),
        recordCloudWatchDashboard: jest.fn(),
        saveToFile: jest.fn(),
    })),
}));

describe("SmallScaleStack", () => {
    let stack: SmallScaleStack;
    let template: Template;

    beforeEach(() => {
        jest.clearAllMocks();
        const app = new cdk.App();
        stack = new SmallScaleStack(app, "TestStack", {
            projectName: "test20250228",
            environment: "development",
        });
        template = Template.fromStack(stack);
    });

    test("スタックが必要な出力を含むこと", () => {
        template.hasOutput("LoadBalancerDNS", Match.anyValue());
        template.hasOutput("S3BucketName", Match.anyValue());
    });
});
