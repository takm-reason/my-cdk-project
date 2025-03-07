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
```bash
# 依存パッケージのインストール
npm install

# 開発依存パッケージの再インストール（クリーン）
npm ci

# AWS CDKの初期化（アカウントごとに初回のみ必要）
cdk bootstrap
```

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
cdk diff SmallScaleStack -c project=your-project

# 2. ユニットテストの実行
npm run test

# 3. デプロイの実行（基本形）
cdk deploy <StackName> -c project=your-project

# スケール別のスタック指定
cdk deploy SmallScaleStack -c project=your-project    # 小規模構成
cdk deploy MediumScaleStack -c project=your-project   # 中規模構成
cdk deploy LargeScaleStack -c project=your-project    # 大規模構成
```

#### 環境別のデプロイ
```bash
# 開発環境へのデプロイ
cdk deploy SmallScaleStack -c project=your-project -c environment=development

# ステージング環境へのデプロイ
cdk deploy SmallScaleStack -c project=your-project -c environment=staging

# 本番環境へのデプロイ
cdk deploy SmallScaleStack -c project=your-project -c environment=production

# リージョン/アカウント指定デプロイ
CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=ap-northeast-1 cdk deploy SmallScaleStack -c project=your-project

# 確認なしでデプロイ（CI/CD環境用）
cdk deploy SmallScaleStack -c project=your-project --require-approval never
```

### 運用管理

#### リソース情報の確認
```bash
# スタックの出力値を確認
cdk list-outputs SmallScaleStack

# 作成されたリソースの一覧を確認
cdk list-resources SmallScaleStack
```

#### スタックの削除
```bash
# スタックの削除（確認あり）
cdk destroy SmallScaleStack

# スタックの強制削除（確認なし）
cdk destroy SmallScaleStack --force
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

## リソース情報の保存

デプロイ時に作成されたリソースの情報は`resource-info`ディレクトリに自動保存されます：
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