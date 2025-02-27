import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { CfnTag } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseResourceBuilder } from '../core/stack-builder';
import { WafConfig } from '../interfaces/config';

export class WafBuilder extends BaseResourceBuilder<wafv2.CfnWebACL, WafConfig> {
    private webAcl?: wafv2.CfnWebACL;

    validate(): boolean {
        if (!this.config.scope) {
            throw new Error('WAF scope is required');
        }

        if (this.config.rules) {
            for (const rule of this.config.rules) {
                if (!rule.name || !rule.priority || !rule.action) {
                    throw new Error('Rule name, priority, and action are required for each WAF rule');
                }
            }
        }

        return true;
    }

    private createDefaultRules(): Required<WafConfig>['rules'] {
        return [
            {
                name: 'AWSManagedRulesCommonRuleSet',
                priority: 1,
                action: 'block',
                overrideAction: 'none',
                statement: {
                    managedRuleGroupStatement: {
                        name: 'AWSManagedRulesCommonRuleSet',
                        vendorName: 'AWS',
                    },
                },
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    metricName: 'AWSManagedRulesCommonRuleSetMetric',
                    sampledRequestsEnabled: true,
                },
            },
            {
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
                priority: 2,
                action: 'block',
                overrideAction: 'none',
                statement: {
                    managedRuleGroupStatement: {
                        name: 'AWSManagedRulesKnownBadInputsRuleSet',
                        vendorName: 'AWS',
                    },
                },
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    metricName: 'AWSManagedRulesKnownBadInputsRuleSetMetric',
                    sampledRequestsEnabled: true,
                },
            },
        ];
    }

    private createRules(): wafv2.CfnWebACL.RuleProperty[] {
        const rules = [...(this.config.rules || []), ...this.createDefaultRules()];

        return rules.map(rule => ({
            name: rule.name,
            priority: rule.priority,
            overrideAction: rule.overrideAction
                ? { [rule.overrideAction]: {} }
                : undefined,
            action: !rule.overrideAction
                ? { [rule.action]: {} }
                : undefined,
            statement: rule.statement,
            visibilityConfig: {
                cloudWatchMetricsEnabled: rule.visibilityConfig?.cloudWatchMetricsEnabled ?? true,
                metricName: rule.visibilityConfig?.metricName ?? `${rule.name}Metric`,
                sampledRequestsEnabled: rule.visibilityConfig?.sampledRequestsEnabled ?? true,
            },
            ...(rule.customResponse && {
                overrideCustomRequestHandling: {
                    customRequestHandling: {
                        customResponseBody: rule.customResponse.responseBodyKey,
                        responseCode: rule.customResponse.responseCode,
                    },
                },
            }),
        }));
    }

    build(): wafv2.CfnWebACL {
        const rules = this.createRules();

        // デフォルトタグを作成
        const defaultTags = {
            Project: this.config.projectName,
            Environment: this.config.environment,
            CreatedBy: 'cdk',
            CreatedAt: new Date().toISOString().split('T')[0],
            ...this.config.tags
        };

        // タグをCfnTagの形式に変換
        const cfnTags: CfnTag[] = Object.entries(defaultTags).map(
            ([key, value]) => ({
                key,
                value,
            })
        );

        this.webAcl = new wafv2.CfnWebACL(this.scope, this.generateName('webacl'), {
            defaultAction: {
                [this.config.defaultAction || 'allow']: {},
            },
            scope: this.config.scope,
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: `${this.config.projectName}-webacl`,
                sampledRequestsEnabled: true,
            },
            rules,
            customResponseBodies: this.config.customResponseBodies
                ? Object.entries(this.config.customResponseBodies).reduce(
                    (acc, [key, content]) => ({
                        ...acc,
                        [key]: {
                            content,
                            contentType: 'TEXT_PLAIN',
                        },
                    }),
                    {}
                )
                : undefined,
            tags: cfnTags,
        });

        return this.webAcl;
    }

    public getWebAcl(): wafv2.CfnWebACL | undefined {
        return this.webAcl;
    }
}