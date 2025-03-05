#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SmallScaleStack } from '../lib/small-scale-stack';
import { MediumScaleStack } from '../lib/medium-scale-stack';
import { LargeScaleStack } from '../lib/large-scale-stack';

const app = new cdk.App();

// プロジェクト名を取得
const projectName = app.node.tryGetContext('project') || 'default-project';

// 共通のスタックProps
const stackProps = {
    projectName,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    }
};

// 全てのスケールのスタックを定義（デプロイは指定されたスタックのみ実行される）
new SmallScaleStack(app, 'SmallScaleStack', stackProps);
new MediumScaleStack(app, 'MediumScaleStack', stackProps);
new LargeScaleStack(app, 'LargeScaleStack', stackProps);
