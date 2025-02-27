import * as cdk from 'aws-cdk-lib';
import { BaseConfig } from '../interfaces/config';
import { IStackBuilder } from '../interfaces/builders';
import { ConfigValidator } from '../helpers/validators';
import { ResourceNaming } from '../helpers/naming';

export abstract class BaseStackBuilder implements IStackBuilder {
    protected readonly scope: cdk.Stack;
    protected readonly config: BaseConfig;
    protected resources: { [key: string]: any } = {};

    constructor(scope: cdk.Stack, config: BaseConfig) {
        this.scope = scope;
        this.config = config;
    }

    protected addTags(resource: cdk.IResource): void {
        const defaultTags = {
            Project: this.config.projectName,
            Environment: this.config.environment,
            CreatedBy: 'cdk',
            CreatedAt: new Date().toISOString().split('T')[0],
            ...this.config.tags
        };

        Object.entries(defaultTags).forEach(([key, value]) => {
            cdk.Tags.of(resource).add(key, value);
        });
    }

    protected generateName(resourceType: string, suffix?: string): string {
        return ResourceNaming.generateName(this.config, resourceType, suffix);
    }

    protected generateLogicalId(resourceType: string, name: string): string {
        return ResourceNaming.generateLogicalId(resourceType, name);
    }

    public prepare(): void {
        // デフォルトの準備処理
        this.validateConfig();
    }

    public validate(): boolean {
        return ConfigValidator.validateBaseConfig(this.config);
    }

    protected validateConfig(): void {
        if (!this.validate()) {
            throw new Error('Invalid configuration');
        }
    }

    public getResource<T>(key: string): T {
        if (!this.resources[key]) {
            throw new Error(`Resource ${key} not found`);
        }
        return this.resources[key] as T;
    }

    protected setResource(key: string, resource: any): void {
        this.resources[key] = resource;
    }

    abstract build(): void;
}

export abstract class BaseResourceBuilder<T, C extends BaseConfig> {
    protected readonly scope: cdk.Stack;
    protected readonly config: C;

    constructor(scope: cdk.Stack, config: C) {
        this.scope = scope;
        this.config = config;
    }

    protected addTags(resource: cdk.IResource): void {
        const defaultTags = {
            Project: this.config.projectName,
            Environment: this.config.environment,
            CreatedBy: 'cdk',
            CreatedAt: new Date().toISOString().split('T')[0],
            ...this.config.tags
        };

        Object.entries(defaultTags).forEach(([key, value]) => {
            cdk.Tags.of(resource).add(key, value);
        });
    }

    protected generateName(resourceType: string, suffix?: string): string {
        return ResourceNaming.generateName(this.config, resourceType, suffix);
    }

    abstract validate(): boolean;
    abstract build(): T;
}