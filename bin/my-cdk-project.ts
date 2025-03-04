#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfraSmallStack } from '../lib/infra-small';
import { InfraMediumStack } from '../lib/infra-medium';
import { InfraLargeStack } from '../lib/infra-large';
import { InfraBaseStackProps } from '../lib/infra-base-stack';

const app = new cdk.App();

// コンテキストからプロジェクト情報を取得
const projectName = app.node.tryGetContext('projectName') || 'MyProject';
const infraSize = app.node.tryGetContext('infraSize') || 'small';
const stackId = `${projectName}-Stack`;

// 共通のスタックプロパティ
const stackProps: InfraBaseStackProps = {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
    description: `Infrastructure stack for ${projectName} (${infraSize})`,
    tags: {
        ProjectName: projectName,
        TemplateName: 'AWS-TypeScript-CDK-Template',
        Environment: infraSize,
        CreatedBy: 'CDK',
        CreatedAt: new Date().toISOString()
    },
    // InfraBaseStackPropsで必要な追加プロパティ
    projectName: projectName,
    environment: infraSize
};

// infraSizeに応じて適切なスタックを作成
switch (infraSize.toLowerCase()) {
    case 'medium':
        new InfraMediumStack(app, stackId, stackProps);
        break;
    case 'large':
        new InfraLargeStack(app, stackId, stackProps);
        break;
    case 'small':
    default:
        new InfraSmallStack(app, stackId, stackProps);
        break;
}

app.synth();