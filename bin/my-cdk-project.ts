#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SmallScaleStack } from '../lib/small-scale-stack';
import { MediumScaleStack } from '../lib/medium-scale-stack';
import { LargeScaleStack } from '../lib/large-scale-stack';

const app = new cdk.App();

// プロジェクト名を取得（必須）
const projectName = app.node.tryGetContext('project');
if (!projectName) {
    throw new Error('Project name must be specified with -c project=<name>');
}

// 環境名を取得（デフォルトはdevelopment）
const envName = app.node.tryGetContext('env') || 'development';

// 共通のスタックProps
const stackProps = {
    projectName,
    environment: envName,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
    tags: {
        Project: projectName,
        Environment: envName
    }
};

// スケールの取得（small, medium, largeのいずれか）
const scale = app.node.tryGetContext('scale');
if (!scale) {
    throw new Error('Scale must be specified with -c scale=<small|medium|large>');
}

// 指定されたスケールのスタックのみを初期化
switch (scale.toLowerCase()) {
    case 'small':
        new SmallScaleStack(app, `${projectName}-${envName}-small`, stackProps);
        break;
    case 'medium':
        new MediumScaleStack(app, `${projectName}-${envName}-medium`, stackProps);
        break;
    case 'large':
        new LargeScaleStack(app, `${projectName}-${envName}-large`, stackProps);
        break;
    default:
        throw new Error('Invalid scale. Must be one of: small, medium, large');
}
