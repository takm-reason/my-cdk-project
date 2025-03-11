# AWS CDK Infrastructureプロジェクト

このプロジェクトは、AWS CDKを使用して異なる規模のインフラストラクチャをコードとして管理するためのテンプレートです。

## 機能

- 3つのスケール（小規模、中規模、大規模）に対応
- リソース情報の自動記録
- 統一的なタグ付け
- プロジェクトごとの分離

## スケール別の構成

### 小規模構成（small）
- VPC（2 AZ、NAT Gateway x1）
- RDS PostgreSQL（Single-AZ）
- S3バケット
- ECS Fargate（Auto Scaling: 1-2台）

### 中規模構成（medium）
- VPC（3 AZ、NAT Gateway x2）
- Aurora PostgreSQL Serverless v2
- ElastiCache Redis
- S3バケット
- CloudFront
- WAF（AWSマネージドルールによる基本的な保護）
- ECS Fargate（Auto Scaling: 2-5台）

### 大規模構成（large）
- VPC（3 AZ、NAT Gateway x3）
- Aurora PostgreSQL Global Database（セカンダリリージョンは別スタックとして実装）
- ElastiCache Redisクラスター（3シャード × 2レプリカ/シャード、マルチAZ）
- S3バケット（インテリジェント階層化）
- CloudFront + Shield Advanced
- WAF（AWSマネージドルール + レートベースの制限）
- ECS Fargate（API: 10-50台、Frontend: 10-30台）
- CI/CDパイプライン
- CloudWatchダッシュボード
- Systems Manager Parameter Store

## 使用方法

### 初期セットアップ

#### 1. 基本セットアップ
```bash
# 依存パッケージのインストール
npm install

# 開発依存パッケージの再インストール（クリーン）
npm ci

# AWS CDKの初期化（アカウントごとに初回のみ必要）
cdk bootstrap
```

#### 2. リソース情報取得用Lambda関数の準備
```bash
# TypeScriptのビルド（Lambda関数のコードも含む）
npm run build

# Lambda関数のコードを確認
ls -l lambda/resource-info-handler.ts
```

Lambda関数は共有リソースとして実装されています：
- 全てのスタックで1つのLambda関数を共有
- 初回デプロイ時に自動的に作成
- 必要なIAM権限は自動的に設定
- 更新は全スタックに即時反映

利点：
- リソースの効率的な利用
- 保守性の向上
- デプロイ時間の短縮
- 一貫性のある情報収集

### 開発作業

#### TypeScript開発コマンド
```bash
# TypeScriptのビルド
npm run build

# 継続的なTypeScriptの監視とビルド
npm run watch

# テストの実行
npm run test
```

#### デプロイ作業フロー
```bash
# 1. スタックの変更内容確認
cdk diff <StackName> -c project=your-project

例：
cdk diff your-project-development-small -c project=your-project

# 2. ユニットテストの実行
npm run test

# 3. デプロイの実行（基本形）
# スタック名の形式: {プロジェクト名}-{環境名}-{スケール}
cdk deploy your-project-development-small -c project=your-project

# スケール別のスタック指定
cdk deploy your-project-development-small -c project=your-project    # 小規模構成
cdk deploy your-project-development-medium -c project=your-project   # 中規模構成
cdk deploy your-project-development-large -c project=your-project    # 大規模構成
```
#### 環境別のデプロイ
```bash
# 開発環境へのデプロイ
cdk deploy your-project-development-small -c project=your-project -c environment=development

# ステージング環境へのデプロイ
cdk deploy your-project-staging-small -c project=your-project -c environment=staging

# 本番環境へのデプロイ
cdk deploy your-project-production-small -c project=your-project -c environment=production

# リージョン/アカウント指定デプロイ
CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=ap-northeast-1 \
cdk deploy your-project-development-small -c project=your-project

# 確認なしでデプロイ（CI/CD環境用）
cdk deploy your-project-development-small -c project=your-project --require-approval never
cdk deploy SmallScaleStack -c project=your-project --require-approval never
```

### 運用管理

#### リソース情報の確認
```bash
# スタックの出力値を確認
cdk list-outputs your-project-development-small

# 作成されたリソースの一覧を確認
cdk list-resources your-project-development-small
```

#### スタックの削除
```bash
# スタックの削除（確認あり）
cdk destroy your-project-development-small

# スタックの強制削除（確認なし）
cdk destroy your-project-development-small --force
```

**重要なパラメータ：**
- `project`: プロジェクト名（必須、デフォルト値: default-project）
- `environment`: 環境名（`production` / `staging` / `development`）

**注意事項：**
- プロジェクト名は一意である必要があります
- CloudFormationスタック名は`{プロジェクト名}-{スタック名}`の形式で生成されます
- S3バケットは保持ポリシーが`RETAIN`に設定されているため、手動削除が必要
- 削除前にS3バケット内のオブジェクトを空にする必要あり
- RDSの自動バックアップは自動的に削除される設定
- スケールの変更は新しいスタックとしてデプロイすることを推奨

### トラブルシューティング

#### よくある問題と解決方法
```bash
# 依存関係の再インストール
npm ci

# キャッシュのクリア
cdk context --clear

# CloudFormationスタックの状態確認
aws cloudformation describe-stacks --stack-name your-project-SmallScaleStack
```

## リソース情報の取得と保存

### リソース情報取得の仕組み

デプロイされたリソースの情報は、以下の方法で取得・保存できます：

1. 手動での情報取得:
   ```bash
   # 開発環境の場合（ファイルに保存）
   npm run get-resource-info -- -p your-project -s your-project-development-small -e development

   # ステージング環境の場合（SSM Parameter Storeに保存）
   npm run get-resource-info -- -p your-project -s your-project-staging-small -e staging

   # 本番環境の場合（SSM Parameter Storeに保存）
   npm run get-resource-info -- -p your-project -s your-project-production-small -e production
   ```

2. 取得方法の選択:
   - 開発環境: ローカルのJSONファイルとして保存（`resource-info/`ディレクトリ）
   - ステージング/本番環境: AWS Systems Manager Parameter Storeに保存
   - パラメータパス形式: `/aws/cdk/{プロジェクト名}/{環境名}/resource-info`

2. 取得される情報:
   - リソースの物理ID
   - 完全なARN
   - 現在のステータス
   - エンドポイントなどの設定値
   - タグ情報

3. 必要なIAM権限:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "cloudformation:DescribeStacks",
           "cloudformation:ListStackResources",
           "ec2:DescribeVpcs",
           "rds:DescribeDBInstances",
           "s3:GetBucketLocation",
           "ecs:DescribeClusters",
           "elasticache:DescribeCacheClusters"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

### リソース情報の保存

収集された情報は`resource-info`ディレクトリに自動保存されます：
- ファイル名形式：`{プロジェクト名}-{タイムスタンプ}.json`
- 保存される情報：
  - リソースの論理ID
  - 物理ID
  - リソースARN
  - デプロイ後のステータス
  - エンドポイントや設定値などの詳細情報
  - CloudFormationスタックの出力値

### 保存される情報の例
```json
{
  "projectName": "your-project",
  "timestamp": "2025-03-07T12:00:00.000Z",
  "resources": [
    {
      "resourceType": "VPC",
      "resourceId": "SmallScaleVPC",
      "physicalId": "vpc-1234567890abcdef0",
      "arn": "arn:aws:ec2:region:account:vpc/vpc-1234567890abcdef0",
      "status": "CREATE_COMPLETE",
      "properties": {
        "vpcId": "vpc-1234567890abcdef0",
        "cidrBlock": "10.0.0.0/16",
        ...
      }
    }
  ],
  "outputs": [
    {
      "OutputKey": "LoadBalancerDNS",
      "OutputValue": "your-lb-123.region.elb.amazonaws.com",
      "Description": "Application Load Balancer DNS Name"
    }
  ]
}
```

### リソース情報取得のタイミングとトラブルシューティング

1. デプロイ時の自動取得:
   - スタックのデプロイ完了直後に自動実行
   - Lambda関数による非同期処理
   - CloudFormationのCustomResourceとして実装

2. トラブルシューティング:
   ```bash
   # Lambda関数のログを確認
   aws logs tail /aws/lambda/your-project-ResourceInfoHandler-XXXX

   # CustomResourceのステータスを確認
   aws cloudformation describe-stack-resources \
     --stack-name your-project-SmallScaleStack \
     --logical-resource-id ResourceInfo
   
   # 保存されたリソース情報を確認
   ls -l resource-info/
   cat resource-info/your-project-YYYY-MM-DDTHH-mm-ss.json
   ```

3. よくある問題と対処:
   - Lambda関数のタイムアウト → タイムアウト時間の延長（現在: 5分）
   - IAM権限不足 → 必要な権限の追加
   - リソース情報の欠落 → CloudWatch Logsでエラーを確認

## タグ付け

すべてのリソースに以下のタグを付与します：

- Project: プロジェクト名（デプロイ時指定）  
- Environment: `production` / `staging` / `development` のみ  
- CreatedBy: `terraform` / `cloudformation` / `cdk` / `manual` のみ  
- CreatedAt: 作成日（YYYY-MM-DD）  

## セキュリティ

- すべてのデータベースは隔離されたサブネットに配置
- すべてのS3バケットでSSL強制
- WAFによるWebアプリケーション保護
- 大規模構成ではShield Advancedによる追加保護

## 監視

- CloudWatchメトリクスによる自動監視
- 大規模構成では包括的なダッシュボード
- ECSコンテナインサイトの有効化
- Auto Scalingメトリクスの監視

## コスト最適化

- 小規模：最小限のリソースで運用
- 中規模：Serverlessコンポーネントの活用
- 大規模：インテリジェント階層化とキャパシティ最適化

## 注意事項

- プロジェクト名は一意である必要があります
- 異なるスケール間での直接的な連携は想定していません
- スケールの変更は新しいスタックとしてデプロイすることを推奨します

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。