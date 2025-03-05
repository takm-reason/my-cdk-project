import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface InfraBaseStackProps extends cdk.StackProps {
    projectName: string;
    environment: string;
}

export class InfrastructureStack extends cdk.Stack {
    protected readonly projectPrefix: string;
    protected readonly envName: string;
    protected readonly resourceSuffix: string;

    // データベース関連のシークレット
    protected databaseSecret: secretsmanager.Secret;

    // Redisのシークレット
    protected redisSecret: secretsmanager.Secret;

    constructor(scope: Construct, id: string, props: InfraBaseStackProps) {
        super(scope, id, props);

        this.projectPrefix = props.projectName;
        this.envName = props.environment;

        // ランダムなサフィックスを生成（8文字）
        this.resourceSuffix = Math.random().toString(36).substring(2, 10);

        // データベースのシークレットを作成
        this.databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
            secretName: `${this.projectPrefix}/${this.envName}/database`,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    username: 'admin',
                    dbname: 'appdb',
                }),
                generateStringKey: 'password',
                excludePunctuation: true,
                passwordLength: 16,
            },
            removalPolicy: this.envName === 'dev' || this.envName === 'staging'
                ? cdk.RemovalPolicy.DESTROY
                : cdk.RemovalPolicy.RETAIN,
        });

        // Redisのシークレットを作成
        this.redisSecret = new secretsmanager.Secret(this, 'RedisSecret', {
            secretName: `${this.projectPrefix}/${this.envName}/redis`,
            generateSecretString: {
                excludePunctuation: true,
                passwordLength: 16,
            },
            removalPolicy: this.envName === 'dev' || this.envName === 'staging'
                ? cdk.RemovalPolicy.DESTROY
                : cdk.RemovalPolicy.RETAIN,
        });

        // CDK Outputs
        new cdk.CfnOutput(this, 'DatabaseSecretArn', {
            value: this.databaseSecret.secretArn,
            description: 'Database Secret ARN',
            exportName: `${this.projectPrefix}-${this.envName}-db-secret-arn`,
        });

        new cdk.CfnOutput(this, 'RedisSecretArn', {
            value: this.redisSecret.secretArn,
            description: 'Redis Secret ARN',
            exportName: `${this.projectPrefix}-${this.envName}-redis-secret-arn`,
        });
    }

    // シークレット取得のヘルパーメソッド
    protected getDatabaseSecretValue(key: string): string {
        return secretsmanager.Secret.fromSecretNameV2(
            this,
            'DatabaseSecretValue',
            `${this.projectPrefix}/${this.envName}/database`
        ).secretValueFromJson(key).toString();
    }

    protected getRedisSecretValue(): string {
        return secretsmanager.Secret.fromSecretNameV2(
            this,
            'RedisSecretValue',
            `${this.projectPrefix}/${this.envName}/redis`
        ).secretValue.toString();
    }
}