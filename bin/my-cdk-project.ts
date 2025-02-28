#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfraSmallStack } from '../lib/infra-small';
import { InfraMediumStack } from '../lib/infra-medium';
import { InfraLargeStack } from '../lib/infra-large';

const app = new cdk.App();

// スタックIDにプロジェクト名を含める
const projectName = app.node.tryGetContext('projectName') || 'MyProject';
const infraSize = app.node.tryGetContext('infraSize') || 'small';
const stackId = `${projectName}-Stack`;

// 共通のスタックプロパティ
const stackProps: cdk.StackProps = {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
    description: `Infrastructure stack for ${projectName} (${infraSize})`
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