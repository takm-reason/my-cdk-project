#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { deployEnvironment } from '../lib/infra-environments';

const app = new cdk.App();

// コマンドライン引数から環境を取得
const targetEnv = app.node.tryGetContext('env') || 'dev';

// 指定された環境のインフラをデプロイ
deployEnvironment(app, targetEnv);

// タグの追加
const stackEnv = app.node.tryGetContext('infraSize') || 'small';
cdk.Tags.of(app).add('Environment', targetEnv);
cdk.Tags.of(app).add('InfraSize', stackEnv);
cdk.Tags.of(app).add('CreatedBy', 'CDK');
cdk.Tags.of(app).add('CreatedAt', new Date().toISOString());
cdk.Tags.of(app).add('TemplateName', 'AWS-TypeScript-CDK-Template');

/* 使用例:
 * 開発環境（small）:
 * cdk deploy --context env=dev
 * 
 * ステージング環境（medium）:
 * cdk deploy --context env=staging
 * 
 * 本番環境（規模を指定）:
 * cdk deploy --context env=prod-small
 * cdk deploy --context env=prod-medium
 * cdk deploy --context env=prod-large
 */