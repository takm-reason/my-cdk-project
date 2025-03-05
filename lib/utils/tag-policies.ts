import * as cdk from 'aws-cdk-lib';
import * as config from 'aws-cdk-lib/aws-config';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface TagPolicyProps {
    scope: cdk.Stack;
    projectName: string;
}

export class TagPolicyManager {
    constructor(private readonly props: TagPolicyProps) { }

    // タグポリシーを強制するためのAWS Configルールを作成
    public createTagComplianceRule(): void {
        // タグポリシーのテンプレートを生成
        const tagPolicyTemplate = this.generateTagPolicyTemplate();

        // タグポリシーのテンプレートを出力
        new cdk.CfnOutput(this.props.scope, 'RequiredTagsPolicy', {
            value: tagPolicyTemplate,
            description: '必須タグのポリシーテンプレート'
        });
        new config.ManagedRule(this.props.scope, 'RequiredTagsRule', {
            configRuleName: `${this.props.projectName}-required-tags`,
            description: '必須タグが設定されているかチェックするルール',
            // リソースタイプを指定（すべてのリソースをチェック）
            identifier: 'REQUIRED_TAGS',
            inputParameters: {
                tag1Key: 'Project',
                tag1Value: this.props.projectName,
                tag2Key: 'Environment',
                tag3Key: 'CreatedBy',
                tag4Key: 'CreatedAt',
            },
        });
    }

    // Organizations Tag Policyを作成するためのCloudFormationテンプレートを生成
    public generateTagPolicyTemplate(): string {
        const tagPolicyTemplate = {
            tags: {
                Project: {
                    tag_key: {
                        '@@assign': 'Project',
                    },
                    tag_value: {
                        'enforce_for_tags_on_resources': true,
                        'values_for_resources': ['@@assign', this.props.projectName],
                    },
                },
                Environment: {
                    tag_key: {
                        '@@assign': 'Environment',
                    },
                    tag_value: {
                        'enforce_for_tags_on_resources': true,
                        'values_for_resources': ['@@assign', ['production', 'staging', 'development']],
                    },
                },
                CreatedBy: {
                    tag_key: {
                        '@@assign': 'CreatedBy',
                    },
                    tag_value: {
                        'enforce_for_tags_on_resources': true,
                        'values_for_resources': ['@@assign', ['terraform', 'cloudformation', 'cdk', 'manual']],
                    },
                },
                CreatedAt: {
                    tag_key: {
                        '@@assign': 'CreatedAt',
                    },
                    tag_value: {
                        'enforce_for_tags_on_resources': true,
                    },
                },
            },
        };

        return JSON.stringify(tagPolicyTemplate, null, 2);
    }

    // 使用方法を示すコメント
    /* 
    使用例：
  
    const tagPolicyManager = new TagPolicyManager({
      scope: this,
      projectName: props.projectName,
    });
  
    // AWS Config ルールの作成
    tagPolicyManager.createTagComplianceRule();
  
    // Tag Policyテンプレートの生成（Organizations管理者に提供）
    const tagPolicyTemplate = tagPolicyManager.generateTagPolicyTemplate();
    new cdk.CfnOutput(this, 'TagPolicyTemplate', {
      value: tagPolicyTemplate,
      description: 'Organizations Tag Policyテンプレート',
    });
    */
}