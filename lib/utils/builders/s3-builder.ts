import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';
import { BaseResourceBuilder } from '../core/stack-builder';
import { StorageConfig } from '../interfaces/config';

export class S3Builder extends BaseResourceBuilder<s3.Bucket, StorageConfig> {
    validate(): boolean {
        if (!this.config.bucketName || this.config.bucketName.trim() === '') {
            throw new Error('Bucket name is required');
        }
        return true;
    }

    build(): s3.Bucket {
        // バケットの作成
        const bucket = new s3.Bucket(this.scope, this.generateName('bucket'), {
            bucketName: this.config.bucketName,
            versioned: this.config.versioned ?? true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
            lifecycleRules: this.createLifecycleRules(),
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.POST,
                        s3.HttpMethods.DELETE,
                        s3.HttpMethods.HEAD,
                    ],
                    allowedOrigins: ['*'],
                    allowedHeaders: ['*'],
                    maxAge: 3600,
                },
            ],
            serverAccessLogsPrefix: 'access-logs/',
        });

        // インベントリの設定
        if (this.config.environment === 'production') {
            this.enableInventory(bucket);
        }

        this.addTags(bucket);
        return bucket;
    }

    private createLifecycleRules(): s3.LifecycleRule[] {
        const rules: s3.LifecycleRule[] = [
            {
                // 古いバージョンの削除ルール
                enabled: true,
                noncurrentVersionExpiration: cdk.Duration.days(90),
                noncurrentVersionTransitions: [
                    {
                        storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                        transitionAfter: cdk.Duration.days(30),
                    },
                    {
                        storageClass: s3.StorageClass.GLACIER,
                        transitionAfter: cdk.Duration.days(60),
                    },
                ],
            },
            {
                // 未完了のマルチパートアップロードの削除
                enabled: true,
                abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
            },
        ];

        // ユーザー指定のライフサイクルルールを追加
        if (this.config.lifecycleRules) {
            this.config.lifecycleRules.forEach(rule => {
                rules.push({
                    enabled: rule.enabled,
                    expiration: rule.expiration
                        ? cdk.Duration.days(rule.expiration)
                        : undefined,
                    transitions: rule.transitions?.map(transition => ({
                        storageClass: s3.StorageClass[transition.storageClass as keyof typeof s3.StorageClass],
                        transitionAfter: cdk.Duration.days(transition.transitionAfter),
                    })),
                });
            });
        }

        return rules;
    }

    private enableInventory(bucket: s3.Bucket): void {
        // インベントリ保存用のバケットを作成
        const inventoryBucket = new s3.Bucket(this.scope, this.generateName('inventory'), {
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // インベントリ設定を追加
        new s3.CfnBucket(this.scope, this.generateName('bucket-inventory'), {
            inventoryConfigurations: [
                {
                    id: 'InventoryDaily',
                    destination: {
                        bucketArn: inventoryBucket.bucketArn,
                        format: 'CSV',
                    },
                    enabled: true,
                    includedObjectVersions: 'Current',
                    scheduleFrequency: 'Daily',
                    optionalFields: [
                        'Size',
                        'LastModifiedDate',
                        'StorageClass',
                        'ETag',
                        'IsMultipartUploaded',
                        'ReplicationStatus',
                        'EncryptionStatus',
                    ],
                },
            ],
        });

        this.addTags(inventoryBucket);
    }
}