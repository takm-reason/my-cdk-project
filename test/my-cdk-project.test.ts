import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as MyCdkProject from '../lib/my-cdk-project-stack';

describe('MyCdkProject Stack', () => {
    const app = new cdk.App();
    const stack = new MyCdkProject.MyCdkProjectStack(app, 'MyTestStack');
    const template = Template.fromStack(stack);

    test('Stack has been created', () => {
        // テンプレートが作成されていることを確認
        template.templateMatches({
            "Resources": {}
        });
    });

    // ここに追加のテストケースを記述できます
});