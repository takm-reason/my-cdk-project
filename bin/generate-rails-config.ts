#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';
import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface ResourceConfig {
    database: {
        host: string;
        port: number;
        database: string;
        username: string;
        password: string;
    };
    storage: {
        bucket_name: string;
        region: string;
        endpoint: string;
        force_path_style: boolean;
    };
    ecr: {
        repository_name: string;
        registry: string;
    };
    aws: {
        region: string;
        vpc_id: string;
        account_id: string;
    };
    ecs: {
        cluster_name: string;
        service_name: string;
        task_definition_arn: string;
        container_name: string;
        log_group_name: string;
    };
    application: {
        name: string;
        environment: string;
        load_balancer_dns: string;
    };
}

interface CloudFormationResource {
    LogicalResourceId: string;
    PhysicalResourceId: string;
    ResourceType: string;
    ResourceStatus: string;
}

interface CloudFormationOutput {
    OutputKey: string;
    OutputValue: string;
    Description?: string;
}

async function getCloudFormationResources(stackName: string): Promise<CloudFormationResource[]> {
    try {
        const command = `aws cloudformation describe-stack-resources --stack-name ${stackName}`;
        const output = execSync(command, { encoding: 'utf-8' });
        const result = JSON.parse(output);
        return result.StackResources;
    } catch (error: any) {
        console.error(`CloudFormationリソース取得エラー: ${error.message}`);
        process.exit(1);
    }
}

async function getCloudFormationOutputs(stackName: string): Promise<CloudFormationOutput[]> {
    try {
        const command = `aws cloudformation describe-stacks --stack-name ${stackName}`;
        const output = execSync(command, { encoding: 'utf-8' });
        const result = JSON.parse(output);
        return result.Stacks[0].Outputs || [];
    } catch (error: any) {
        console.error(`CloudFormationアウトプット取得エラー: ${error.message}`);
        process.exit(1);
    }
}

interface RDSSecret {
    dbname: string;
    username: string;
    password: string;
    host: string;
    port: number;
}

async function getRDSSecretValue(secretArn: string): Promise<RDSSecret> {
    try {
        const command = `aws secretsmanager get-secret-value --secret-id ${secretArn}`;
        const result = JSON.parse(execSync(command, { encoding: 'utf-8' }));
        return JSON.parse(result.SecretString);
    } catch (error: any) {
        console.error(`シークレット情報の取得に失敗しました: ${error.message}`);
        process.exit(1);
    }
}

interface RDSEndpoint {
    host: string;
    port: number;
}

async function getRDSEndpoint(instanceId: string): Promise<RDSEndpoint> {
    try {
        const command = `aws rds describe-db-instances --db-instance-identifier ${instanceId}`;
        const result = JSON.parse(execSync(command, { encoding: 'utf-8' }));
        const instance = result.DBInstances[0];
        return {
            host: instance.Endpoint.Address,
            port: instance.Endpoint.Port
        };
    } catch (error: any) {
        console.error(`RDSインスタンス情報の取得に失敗しました: ${error.message}`);
        process.exit(1);
    }
}

async function getAccountId(): Promise<string> {
    try {
        const command = `aws sts get-caller-identity --query Account --output text`;
        return execSync(command, { encoding: 'utf-8' }).trim();
    } catch (error: any) {
        console.error(`AWSアカウントID取得エラー: ${error.message}`);
        process.exit(1);
    }
}

async function getResourceInfo(stackName: string): Promise<{
    dbInstanceId: string;
    dbSecretArn: string;
    bucketName: string;
    loadBalancerDns: string;
    vpcId: string;
    ecsCluster: CloudFormationResource;
    ecsService: CloudFormationResource;
    ecsTaskDef: CloudFormationResource;
    logGroup: CloudFormationResource;
    ecrRepository: string;
}> {
    const resources = await getCloudFormationResources(stackName);
    const outputs = await getCloudFormationOutputs(stackName);

    // RDSインスタンスの物理IDを取得
    const rdsResource = resources.find(r => r.ResourceType === 'AWS::RDS::DBInstance');
    if (!rdsResource) {
        throw new Error('RDSインスタンスが見つかりません');
    }

    // RDSシークレットの物理IDを取得
    const secretResource = resources.find(r => r.ResourceType === 'AWS::SecretsManager::Secret');
    if (!secretResource) {
        throw new Error('RDSシークレットが見つかりません');
    }

    // S3バケットの物理IDを取得
    const s3Resource = resources.find(r => r.ResourceType === 'AWS::S3::Bucket');
    if (!s3Resource) {
        throw new Error('S3バケットが見つかりません');
    }

    // VPCの物理IDを取得
    const vpcResource = resources.find(r => r.ResourceType === 'AWS::EC2::VPC');
    if (!vpcResource) {
        throw new Error('VPCが見つかりません');
    }

    // ECSリソースを取得
    const ecsCluster = resources.find(r => r.ResourceType === 'AWS::ECS::Cluster');
    if (!ecsCluster) {
        throw new Error('ECSクラスターが見つかりません');
    }

    const ecsService = resources.find(r => r.ResourceType === 'AWS::ECS::Service');
    if (!ecsService) {
        throw new Error('ECSサービスが見つかりません');
    }

    const ecsTaskDef = resources.find(r => r.ResourceType === 'AWS::ECS::TaskDefinition');
    if (!ecsTaskDef) {
        throw new Error('ECSタスク定義が見つかりません');
    }

    const logGroup = resources.find(r => r.ResourceType === 'AWS::Logs::LogGroup');
    if (!logGroup) {
        throw new Error('CloudWatch Logsグループが見つかりません');
    }

    // ロードバランサーDNSを取得
    const lbDns = outputs.find(o => o.OutputKey === 'LoadBalancerDNS')?.OutputValue;
    if (!lbDns) {
        throw new Error('ロードバランサーDNSが見つかりません');
    }

    // ECRリポジトリ名を取得
    const ecrRepoName = outputs.find(o => o.OutputKey === 'EcrRepositoryName')?.OutputValue;
    if (!ecrRepoName) {
        throw new Error('ECRリポジトリ名が見つかりません');
    }

    return {
        dbInstanceId: rdsResource.PhysicalResourceId,
        dbSecretArn: secretResource.PhysicalResourceId,
        bucketName: s3Resource.PhysicalResourceId,
        loadBalancerDns: lbDns,
        vpcId: vpcResource.PhysicalResourceId,
        ecsCluster,
        ecsService,
        ecsTaskDef,
        logGroup,
        ecrRepository: ecrRepoName
    };
}

function ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

async function generateConfig(projectName: string, environment: string = 'development'): Promise<void> {
    const stackName = `${projectName}-${environment}-small`;
    const region = 'ap-northeast-1';
    const accountId = await getAccountId();

    // AWS リソース情報を取得
    const resourceInfo = await getResourceInfo(stackName);

    // RDSエンドポイント情報を取得
    const dbEndpoint = await getRDSEndpoint(resourceInfo.dbInstanceId);

    // RDSのシークレット情報を取得
    const dbSecret = await getRDSSecretValue(resourceInfo.dbSecretArn);

    const config: ResourceConfig = {
        database: {
            host: dbEndpoint.host,
            port: dbEndpoint.port,
            database: dbSecret.dbname || 'postgres',
            username: dbSecret.username,
            password: dbSecret.password
        },
        storage: {
            bucket_name: resourceInfo.bucketName,
            region: region,
            endpoint: `https://s3.${region}.amazonaws.com`,
            force_path_style: false
        },
        aws: {
            region: region,
            vpc_id: resourceInfo.vpcId,
            account_id: accountId
        },
        ecr: {
            repository_name: resourceInfo.ecrRepository,
            registry: `${accountId}.dkr.ecr.${region}.amazonaws.com`
        },
        ecs: {
            cluster_name: resourceInfo.ecsCluster.PhysicalResourceId,
            service_name: resourceInfo.ecsService.PhysicalResourceId.split('/').pop() || '',
            task_definition_arn: resourceInfo.ecsTaskDef.PhysicalResourceId,
            container_name: 'web',
            log_group_name: resourceInfo.logGroup.PhysicalResourceId
        },
        application: {
            name: projectName,
            environment: environment,
            load_balancer_dns: resourceInfo.loadBalancerDns
        }
    };

    // プロジェクトディレクトリ構造を作成
    const projectDir = path.join(process.cwd(), 'projects', projectName);
    ensureDirectoryExists(projectDir);

    // 設定ファイルを生成
    const yamlContent = yaml.dump(config, {
        indent: 2,
        lineWidth: -1
    });

    const filePath = path.join(projectDir, `aws_resources.${environment}.yml`);
    fs.writeFileSync(filePath, yamlContent, 'utf-8');

    console.log(`設定ファイルを生成しました: ${filePath}`);
    console.log('\n設定内容:');
    console.log(yamlContent);
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('project', {
            type: 'string',
            description: 'プロジェクト名',
            required: true
        })
        .option('environment', {
            type: 'string',
            description: '環境名 (development/staging/production)',
            choices: ['development', 'staging', 'production'],
            default: 'development'
        })
        .argv;

    await generateConfig(argv.project, argv.environment);
}

main().catch(error => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
});