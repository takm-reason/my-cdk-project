import * as cdk from 'aws-cdk-lib';
import { BaseConfig } from './config';

export interface IBuilder<T> {
    build(): T;
}

export interface IResourceBuilder<T> extends IBuilder<T> {
    addTags(tags: { [key: string]: string }): this;
    validate(): boolean;
}

export interface IStackBuilder {
    prepare(): void;
    validate(): boolean;
    build(): void;
}