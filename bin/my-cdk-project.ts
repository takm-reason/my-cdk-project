#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SmallScaleStack } from '../lib/small-scale-stack';
import { MediumScaleStack } from '../lib/medium-scale-stack';
import { LargeScaleStack } from '../lib/large-scale-stack';

const app = new cdk.App();

// 環境変数からスケールサイズとステージを取得
// SCALE: small, medium, large
// STAGE: dev, staging, prod
const scale = process.env.SCALE || 'small';
const stage = process.env.STAGE || 'dev';

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

// スケールサイズに応じたスタックを作成
switch (scale) {
    case 'small':
        new SmallScaleStack(app, `SmallScale-${stage}`, {
            env: envConfig[stage as keyof typeof envConfig],
            description: `Small scale stack for ${stage} environment`
        });
        break;

    case 'medium':
        new MediumScaleStack(app, `MediumScale-${stage}`, {
            env: envConfig[stage as keyof typeof envConfig],
            description: `Medium scale stack for ${stage} environment`
        });
        break;

    case 'large':
        new LargeScaleStack(app, `LargeScale-${stage}`, {
            env: envConfig[stage as keyof typeof envConfig],
            description: `Large scale stack for ${stage} environment`
        });
        break;

    default:
        throw new Error(`Invalid scale size: ${scale}`);
}
