#!/usr/bin/env node
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import * as fs from 'fs';
import * as path from 'path';

interface SecretValues {
    database: {
        username: string;
        password: string;
        dbname: string;
    };
    redis: {
        authToken: string;
    };
}

async function getSecret(
    secretsManager: SecretsManager,
    projectName: string,
    environment: string,
    secretType: 'database' | 'redis'
): Promise<any> {
    const secretName = `${projectName}/${environment}/${secretType}`;
    try {
        const response = await secretsManager.getSecretValue({ SecretId: secretName });
        return JSON.parse(response.SecretString || '{}');
    } catch (error) {
        console.error(`Error fetching ${secretType} secret:`, error);
        throw error;
    }
}

async function generateEnvFile(projectName: string, environment: string, outputPath: string): Promise<void> {
    const secretsManager = new SecretsManager({
        region: process.env.AWS_REGION || 'ap-northeast-1'
    });

    try {
        // データベースとRedisのシークレットを取得
        const [dbSecret, redisSecret] = await Promise.all([
            getSecret(secretsManager, projectName, environment, 'database'),
            getSecret(secretsManager, projectName, environment, 'redis')
        ]);

        // .env形式の内容を生成
        const envContent = [
            '# Database configuration',
            `DATABASE_USERNAME=${dbSecret.username}`,
            `DATABASE_PASSWORD=${dbSecret.password}`,
            `DATABASE_NAME=${dbSecret.dbname}`,
            '',
            '# Redis configuration',
            `REDIS_AUTH_TOKEN=${redisSecret.authToken}`,
            '',
            '# Environment',
            `RAILS_ENV=${environment === 'dev' ? 'development' : environment}`,
            ''
        ].join('\n');

        // ファイルを保存
        fs.writeFileSync(outputPath, envContent, 'utf8');
        console.log(`Successfully generated ${outputPath}`);
        console.log('⚠️  注意: このファイルには機密情報が含まれています。Git管理に含めないでください。');

    } catch (error) {
        console.error('Error generating .env file:', error);
        process.exit(1);
    }
}

// コマンドライン引数の処理
const args = process.argv.slice(2);
const projectName = args[0];
const environment = args[1];
const outputFile = args[2] || '.env.local';

if (!projectName || !environment) {
    console.error('Usage: npx ts-node scripts/get-secrets.ts <projectName> <environment> [outputFile]');
    console.error('Example: npx ts-node scripts/get-secrets.ts MyProject dev .env.local');
    process.exit(1);
}

// スクリプトの実行
generateEnvFile(projectName, environment, outputFile).catch(console.error);