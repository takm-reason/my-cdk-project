#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MyCdkProjectStack } from '../lib/my-cdk-project-stack';

const app = new cdk.App();

// スタックIDにプロジェクト名を含める
const projectName = app.node.tryGetContext('projectName') || 'MyProject';
const stackId = `${projectName}-Stack`;

new MyCdkProjectStack(app, stackId, {
    /* スタックに必要なプロパティがあればここで定義 */
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
    description: `Infrastructure stack for ${projectName}`
});

app.synth();