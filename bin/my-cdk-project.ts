#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SmallScaleStack } from '../lib/small-scale-stack';
import { MediumScaleStack } from '../lib/medium-scale-stack';
import { LargeScaleStack } from '../lib/large-scale-stack';

const app = new cdk.App();

// コマンドライン引数からスケールタイプとプロジェクト名を取得
const scaleType = app.node.tryGetContext('scale') || 'small';
const projectName = app.node.tryGetContext('project') || 'default-project';

// 共通のスタックProps
const stackProps = {
    projectName,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    }
};

// 指定されたスケールタイプのスタックのみをデプロイ
switch (scaleType.toLowerCase()) {
    case 'small':
        new SmallScaleStack(app, 'SmallScaleStack', stackProps);
        console.log('Deploying Small Scale Stack');
        break;
    case 'medium':
        new MediumScaleStack(app, 'MediumScaleStack', stackProps);
        console.log('Deploying Medium Scale Stack');
        break;
    case 'large':
        new LargeScaleStack(app, 'LargeScaleStack', stackProps);
        console.log('Deploying Large Scale Stack');
        break;
    default:
        throw new Error(`Invalid scale type: ${scaleType}. Must be one of: small, medium, large`);
}
