#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { SmallScaleStack } from '../lib/small-scale-stack';
import { MediumScaleStack } from '../lib/medium-scale-stack';
import { LargeScaleStack } from '../lib/large-scale-stack';

const app = new cdk.App();

// CDKコンテキストからパラメータを取得
const scale = app.node.tryGetContext('scale') || 'small';
const stage = app.node.tryGetContext('stage') || 'dev';
const projectName = app.node.tryGetContext('project-name') || 'default';

// パラメータの検証
if (!['small', 'medium', 'large'].includes(scale)) {
    throw new Error(`Invalid scale size: ${scale}. Must be one of: small, medium, large`);
}

if (!['dev', 'staging', 'prod'].includes(stage)) {
    throw new Error(`Invalid stage: ${stage}. Must be one of: dev, staging, prod`);
}

// 環境固有の設定
const envConfig = {
    dev: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1'
    },
    staging: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1'
    },
    prod: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1'
    }
};

// スタック名の生成
const stackName = `${projectName}-${scale}-${stage}`;

// スケールサイズに応じたスタックを作成
const createStack = (): cdk.Stack => {
    const stackProps = {
        env: envConfig[stage as keyof typeof envConfig],
        description: `${scale} scale stack for ${projectName} in ${stage} environment`
    };

    switch (scale) {
        case 'small':
            return new SmallScaleStack(app, stackName, stackProps);
        case 'medium':
            return new MediumScaleStack(app, stackName, stackProps);
        case 'large':
            return new LargeScaleStack(app, stackName, stackProps);
        default:
            throw new Error(`Invalid scale size: ${scale}`);
    }
};

// スタックを作成
const stack = createStack();

// スタック全体にタグを追加
cdk.Tags.of(stack).add('stage', stage);
cdk.Tags.of(stack).add('project-name', projectName);
