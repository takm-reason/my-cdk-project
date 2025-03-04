import { App } from 'aws-cdk-lib';
import { InfraDevStack } from './infra-dev';
import { InfraSmallStack } from './infra-small';
import { InfraMediumStack } from './infra-medium';
import { InfraLargeStack } from './infra-large';

export interface EnvironmentConfig {
    account: string;
    region: string;
    projectName: string;
    envName: string;
    environment: 'development' | 'staging' | 'production';
    infraSize: 'small' | 'medium' | 'large';
}

// 環境ごとの設定
const environments: { [key: string]: EnvironmentConfig } = {
    dev: {
        account: process.env.CDK_DEFAULT_ACCOUNT!,
        region: 'ap-northeast-1',
        projectName: 'MyProject',
        envName: 'dev',
        environment: 'development',
        infraSize: 'small',  // 開発環境は小規模リソース
    },
    staging: {
        account: process.env.CDK_DEFAULT_ACCOUNT!,
        region: 'ap-northeast-1',
        projectName: 'MyProject',
        envName: 'staging',
        environment: 'staging',
        infraSize: 'medium',  // ステージング環境は中規模リソース
    },
    'prod-small': {
        account: process.env.CDK_DEFAULT_ACCOUNT!,
        region: 'ap-northeast-1',
        projectName: 'MyProject',
        envName: 'prod',
        environment: 'production',
        infraSize: 'small',  // 小規模な本番環境
    },
    'prod-medium': {
        account: process.env.CDK_DEFAULT_ACCOUNT!,
        region: 'ap-northeast-1',
        projectName: 'MyProject',
        envName: 'prod',
        environment: 'production',
        infraSize: 'medium',  // 中規模な本番環境
    },
    'prod-large': {
        account: process.env.CDK_DEFAULT_ACCOUNT!,
        region: 'ap-northeast-1',
        projectName: 'MyProject',
        envName: 'prod',
        environment: 'production',
        infraSize: 'large',  // 大規模な本番環境
    },
};

export function deployEnvironment(app: App, envName: string) {
    const config = environments[envName];
    if (!config) {
        throw new Error(`Unknown environment: ${envName}`);
    }

    const stackProps = {
        env: {
            account: config.account,
            region: config.region,
        },
        projectName: config.projectName,
        envName: config.envName,
        environment: config.environment,
    };

    // 開発環境の場合は専用のスタックを使用
    if (config.environment === 'development') {
        return new InfraDevStack(app, `${config.projectName}-${config.envName}`, stackProps);
    }

    // その他の環境はサイズに応じたスタックを使用
    switch (config.infraSize) {
        case 'small':
            return new InfraSmallStack(app, `${config.projectName}-${config.envName}`, stackProps);
        case 'medium':
            return new InfraMediumStack(app, `${config.projectName}-${config.envName}`, stackProps);
        case 'large':
            return new InfraLargeStack(app, `${config.projectName}-${config.envName}`, stackProps);
        default:
            throw new Error(`Unknown infrastructure size: ${config.infraSize}`);
    }
}

// 使用例：
// const app = new App();
// deployEnvironment(app, 'dev');           // 開発環境（small）
// deployEnvironment(app, 'staging');       // ステージング環境（medium）
// deployEnvironment(app, 'prod-small');    // 小規模本番環境
// deployEnvironment(app, 'prod-medium');   // 中規模本番環境
// deployEnvironment(app, 'prod-large');    // 大規模本番環境