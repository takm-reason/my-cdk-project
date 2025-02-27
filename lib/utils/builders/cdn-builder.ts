import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { BaseResourceBuilder } from '../core/stack-builder';
import { CdnConfig } from '../interfaces/config';

export class CdnBuilder extends BaseResourceBuilder<cloudfront.Distribution, CdnConfig> {
    private distribution?: cloudfront.Distribution;

    validate(): boolean {
        if (!this.config.s3Bucket) {
            throw new Error('S3 bucket is required for CDN configuration');
        }

        if (this.config.customDomain) {
            if (!this.config.customDomain.certificate) {
                throw new Error('Certificate is required when custom domain is specified');
            }
            if (!this.config.customDomain.domainName) {
                throw new Error('Domain name is required when custom domain is specified');
            }
        }

        return true;
    }

    build(): cloudfront.Distribution {
        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this.scope, this.generateName('oai'), {
            comment: `OAI for ${this.config.projectName}`,
        });

        // S3バケットポリシーの設定
        this.config.s3Bucket.grantRead(originAccessIdentity);

        const distributionProps: cloudfront.DistributionProps = {
            defaultBehavior: {
                origin: new origins.S3Origin(this.config.s3Bucket, {
                    originAccessIdentity,
                }),
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                },
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                },
            ],
            enableLogging: this.config.enableLogging ?? true,
            ...(this.config.enableLogging && {
                logBucket: new s3.Bucket(this.scope, this.generateName('cdn-logs'), {
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                    autoDeleteObjects: true,
                    lifecycleRules: [
                        {
                            expiration: cdk.Duration.days(this.config.logRetentionDays ?? 30),
                        },
                    ],
                }),
            }),
            // カスタムドメインの設定
            ...(this.config.customDomain && {
                domainNames: [this.config.customDomain.domainName],
                certificate: this.config.customDomain.certificate,
            }),
            // WAFの設定
            ...(this.config.webAcl && {
                webAclId: this.config.webAcl.attrArn,
            }),
        };

        this.distribution = new cloudfront.Distribution(
            this.scope,
            this.generateName('distribution'),
            distributionProps
        );

        // タグの設定
        this.addTags(this.distribution);

        return this.distribution;
    }

    public getDistribution(): cloudfront.Distribution | undefined {
        return this.distribution;
    }
}