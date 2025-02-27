import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { BaseResourceBuilder } from '../core/stack-builder';
import { SecurityGroupConfig } from '../interfaces/config';

export class SecurityGroupBuilder extends BaseResourceBuilder<ec2.SecurityGroup, SecurityGroupConfig> {
    private securityGroup?: ec2.SecurityGroup;

    validate(): boolean {
        if (!this.config.vpc) {
            throw new Error('VPC is required for security group configuration');
        }

        if (!this.config.name || this.config.name.trim() === '') {
            throw new Error('Security group name is required');
        }

        if (!this.config.description || this.config.description.trim() === '') {
            throw new Error('Security group description is required');
        }

        if (this.config.allowInbound) {
            for (const rule of this.config.allowInbound) {
                if (!rule.port || !rule.source) {
                    throw new Error('Port and source are required for inbound rules');
                }
            }
        }

        return true;
    }

    build(): ec2.SecurityGroup {
        this.securityGroup = new ec2.SecurityGroup(this.scope, this.generateName('sg'), {
            vpc: this.config.vpc,
            securityGroupName: this.config.name,
            description: this.config.description,
            allowAllOutbound: false, // 明示的なルールのみを許可
        });

        // インバウンドルールの追加
        if (this.config.allowInbound && this.config.allowInbound.length > 0) {
            this.addIngressRules(this.config.allowInbound);
        }

        // デフォルトのアウトバウンドルール（HTTP/HTTPS）
        this.addDefaultEgressRules();

        // タグの設定
        this.addTags(this.securityGroup);

        return this.securityGroup;
    }

    private addIngressRules(rules: SecurityGroupConfig['allowInbound']): void {
        if (!rules) return;

        rules.forEach((rule, index) => {
            if (!this.securityGroup) return;

            this.securityGroup.addIngressRule(
                rule.source,
                ec2.Port.tcp(rule.port),
                rule.description || `Ingress Rule ${index + 1}`
            );
        });
    }

    private addDefaultEgressRules(): void {
        if (!this.securityGroup) return;

        // HTTP
        this.securityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(80),
            'Allow HTTP outbound'
        );

        // HTTPS
        this.securityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Allow HTTPS outbound'
        );

        // DNS (UDP)
        this.securityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.udp(53),
            'Allow DNS (UDP) outbound'
        );

        // DNS (TCP)
        this.securityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(53),
            'Allow DNS (TCP) outbound'
        );
    }

    public getSecurityGroup(): ec2.SecurityGroup | undefined {
        return this.securityGroup;
    }
}