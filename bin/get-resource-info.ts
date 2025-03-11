#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface ResourceInfo {
    projectName: string;
    timestamp: string;
    resources: Resource[];
    outputs: any[];
}

interface Resource {
    resourceType: string;
    resourceId: string;
    properties: {
        [key: string]: any;
    };
}

async function getLatestResourceFile(directory: string): Promise<string> {
    try {
        const files = fs.readdirSync(directory)
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(directory, file));

        if (files.length === 0) {
            throw new Error('リソース情報ファイルが見つかりません');
        }

        return files.reduce((latest, current) => {
            const latestStat = fs.statSync(latest);
            const currentStat = fs.statSync(current);
            return currentStat.mtime > latestStat.mtime ? current : latest;
        });
    } catch (error: any) {
        console.error(`エラー: ${error?.message || '不明なエラーが発生しました'}`);
        process.exit(1);
    }
}

function loadResourceInfo(filePath: string): ResourceInfo {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error: any) {
        console.error(`ファイルの読み込みエラー: ${error?.message || '不明なエラーが発生しました'}`);
        process.exit(1);
    }
}

async function getAwsResourceInfo(resourceType: string, resourceId: string): Promise<any> {
    try {
        let command: string;
        switch (resourceType) {
            case 'VPC':
                command = `aws ec2 describe-vpcs --filters Name=tag:Name,Values=${resourceId}`;
                break;
            case 'RDS':
                command = `aws rds describe-db-instances --db-instance-identifier ${resourceId}`;
                break;
            case 'S3':
                command = `aws s3api get-bucket-location --bucket ${resourceId}`;
                break;
            case 'ECS':
                command = `aws ecs describe-clusters --clusters ${resourceId}`;
                break;
            default:
                return null;
        }

        const output = execSync(command, { encoding: 'utf-8' });
        return JSON.parse(output);
    } catch (error: any) {
        console.error(`AWS情報取得エラー: ${error?.message || '不明なエラーが発生しました'}`);
        return null;
    }
}

function formatResourceInfo(resource: Resource): string {
    const output: string[] = [];
    output.push(`リソースタイプ: ${resource.resourceType}`);
    output.push(`リソースID: ${resource.resourceId}`);
    output.push('プロパティ:');

    Object.entries(resource.properties).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            output.push(`  ${key}:`);
            value.forEach(item => {
                if (typeof item === 'object') {
                    Object.entries(item).forEach(([k, v]) => {
                        output.push(`    - ${k}: ${v}`);
                    });
                } else {
                    output.push(`    - ${item}`);
                }
            });
        } else if (typeof value === 'object') {
            output.push(`  ${key}:`);
            Object.entries(value).forEach(([k, v]) => {
                output.push(`    ${k}: ${v}`);
            });
        } else {
            output.push(`  ${key}: ${value}`);
        }
    });

    return output.join('\n');
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('project', {
            type: 'string',
            description: 'プロジェクト名でフィルタ',
        })
        .option('type', {
            type: 'string',
            description: 'リソースタイプでフィルタ (VPC, RDS, S3, ECS)',
            choices: ['VPC', 'RDS', 'S3', 'ECS'],
        })
        .argv;

    const resourceInfoDir = path.join(process.cwd(), 'resource-info');
    const latestFile = await getLatestResourceFile(resourceInfoDir);
    const data = loadResourceInfo(latestFile);

    console.log('=== リソース情報 ===');
    console.log(`プロジェクト名: ${data.projectName}`);
    console.log(`タイムスタンプ: ${data.timestamp}`);
    console.log('==================\n');

    for (const resource of data.resources) {
        if (argv.project && argv.project !== data.projectName) continue;
        if (argv.type && argv.type !== resource.resourceType) continue;

        console.log(formatResourceInfo(resource));
        console.log('-'.repeat(50));

        const awsInfo = await getAwsResourceInfo(resource.resourceType, resource.resourceId);
        if (awsInfo) {
            console.log('AWS上の実際のリソース情報:');
            console.log(JSON.stringify(awsInfo, null, 2));
            console.log('-'.repeat(50));
        }
    }
}

main().catch(error => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
});