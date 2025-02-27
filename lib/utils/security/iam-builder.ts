import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { BaseResourceBuilder } from '../core/stack-builder';
import { IamRoleConfig, IamPolicyConfig } from '../interfaces/config';

export class IamRoleBuilder extends BaseResourceBuilder<iam.Role, IamRoleConfig> {
    private role?: iam.Role;

    validate(): boolean {
        if (!this.config.roleName || this.config.roleName.trim() === '') {
            throw new Error('Role name is required');
        }

        if (!this.config.description || this.config.description.trim() === '') {
            throw new Error('Role description is required');
        }

        if (!this.config.assumedBy) {
            throw new Error('AssumedBy principal is required');
        }

        return true;
    }

    private createInlinePolicies(): { [name: string]: iam.PolicyDocument } {
        const policies: { [name: string]: iam.PolicyDocument } = {};

        if (this.config.inlinePolicies) {
            Object.entries(this.config.inlinePolicies).forEach(([policyName, statements]) => {
                policies[policyName] = new iam.PolicyDocument({
                    statements: statements.map(
                        statement =>
                            new iam.PolicyStatement({
                                actions: statement.actions,
                                resources: statement.resources,
                                effect: statement.effect || iam.Effect.ALLOW,
                                conditions: statement.conditions,
                            })
                    ),
                });
            });
        }

        return policies;
    }

    private addManagedPolicies(): void {
        if (!this.role || !this.config.managedPolicies) return;

        this.config.managedPolicies.forEach(policyName => {
            this.role!.addManagedPolicy(
                iam.ManagedPolicy.fromAwsManagedPolicyName(policyName)
            );
        });
    }

    build(): iam.Role {
        const inlinePolicies = this.createInlinePolicies();

        this.role = new iam.Role(this.scope, this.generateName('role'), {
            roleName: this.config.roleName,
            description: this.config.description,
            assumedBy: this.config.assumedBy,
            inlinePolicies,
            maxSessionDuration: this.config.maxSessionDuration
                ? cdk.Duration.seconds(this.config.maxSessionDuration)
                : undefined,
        });

        this.addManagedPolicies();
        this.addTags(this.role);

        return this.role;
    }

    public getRole(): iam.Role | undefined {
        return this.role;
    }
}

export class IamPolicyBuilder extends BaseResourceBuilder<iam.ManagedPolicy, IamPolicyConfig> {
    private policy?: iam.ManagedPolicy;

    validate(): boolean {
        if (!this.config.policyName || this.config.policyName.trim() === '') {
            throw new Error('Policy name is required');
        }

        if (!this.config.description || this.config.description.trim() === '') {
            throw new Error('Policy description is required');
        }

        if (!this.config.statements || this.config.statements.length === 0) {
            throw new Error('At least one policy statement is required');
        }

        return true;
    }

    build(): iam.ManagedPolicy {
        const statements = this.config.statements.map(
            statement =>
                new iam.PolicyStatement({
                    actions: statement.actions,
                    resources: statement.resources,
                    effect: statement.effect || iam.Effect.ALLOW,
                    conditions: statement.conditions,
                })
        );

        this.policy = new iam.ManagedPolicy(this.scope, this.generateName('policy'), {
            managedPolicyName: this.config.policyName,
            description: this.config.description,
            statements,
        });

        this.addTags(this.policy);

        return this.policy;
    }

    public getPolicy(): iam.ManagedPolicy | undefined {
        return this.policy;
    }
}