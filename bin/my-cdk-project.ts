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

// スケールごとのスタックを定義（デプロイは指定されたスタックのみ実行される）
new SmallScaleStack(app, `${projectName}-${envName}-small`, stackProps);
new MediumScaleStack(app, `${projectName}-${envName}-medium`, stackProps);
new LargeScaleStack(app, `${projectName}-${envName}-large`, stackProps);
