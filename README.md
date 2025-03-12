# AWS CDK Infrastructureプロジェクト

このプロジェクトは、AWS CDKを使用して異なる規模のインフラストラクチャをコードとして管理するためのテンプレートです。

## 機能

- 3つのスケール（小規模、中規模、大規模）に対応
- リソース情報の自動記録
- 統一的なタグ付け
- プロジェクトごとの分離
- リソース情報の取得と表示

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
cdk deploy -c project=your-project -c scale=small    # 小規模構成
cdk deploy -c project=your-project -c scale=medium   # 中規模構成
cdk deploy -c project=your-project -c scale=large    # 大規模構成
```

#### 環境別のデプロイ
```bash
# 開発環境へのデプロイ
cdk deploy -c project=your-project -c scale=small -c environment=development

# ステージング環境へのデプロイ
cdk deploy -c project=your-project -c scale=small -c environment=staging

# 本番環境へのデプロイ
cdk deploy -c project=your-project -c scale=small -c environment=production

# リージョン/アカウント指定デプロイ
CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=ap-northeast-1 cdk deploy -c project=your-project -c scale=small

# 確認なしでデプロイ（CI/CD環境用）
cdk deploy -c project=your-project -c scale=small --require-approval never
```

### 運用管理

#### リソース情報の確認
```bash
# スタックの出力値を確認
cdk list-outputs SmallScaleStack

# 作成されたリソースの一覧を確認
cdk list-resources SmallScaleStack

# デプロイされたリソースの詳細情報を表示
npm run get-resources

# 特定のプロジェクトのリソース情報を表示
npm run get-resources -- --project your-project-name

# 特定のリソースタイプの情報を表示
npm run get-resources -- --type VPC
npm run get-resources -- --type RDS
npm run get-resources -- --type S3
npm run get-resources -- --type ECS

# プロジェクトとリソースタイプを組み合わせて表示
npm run get-resources -- --project your-project-name --type RDS
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
- 保存される情報：リソースARN、エンドポイント、設定値など

### リソース情報の出力内容
- プロジェクト名とタイムスタンプ
- リソースタイプとID
- 設定されているプロパティ
- AWS CLIによる実際のリソース状態

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

## Rails用リソース設定の生成

プロジェクトごとのAWSリソース設定をYAMLファイルとして生成するコマンドを提供しています。

### 生成コマンド
```bash
# 基本形式
npm run generate-rails-config -- --project <project-name> --environment <environment>

# 開発環境の設定生成
npm run generate-rails-config -- --project your-project --environment development

# ステージング環境の設定生成
npm run generate-rails-config -- --project your-project --environment staging

# 本番環境の設定生成
npm run generate-rails-config -- --project your-project --environment production
```

### 生成される設定ファイル

設定ファイルは以下のパスに生成されます：
```
resource-info/projects/<project-name>/aws_resources.<environment>.yml
```

生成される設定には以下の情報が含まれます：

1. データベース接続情報
   - ホスト名
   - ポート番号
   - データベース名
   - ユーザー名
   - パスワード

2. S3ストレージ設定
   - バケット名
   - リージョン
   - エンドポイント

3. AWS共通設定
   - リージョン
   - VPC ID
   - アカウントID

4. ECS関連設定
   - クラスター名
   - サービス名
   - タスク定義ARN
   - コンテナ名
   - CloudWatchロググループ名

5. アプリケーション情報
   - プロジェクト名
   - 環境名
   - ロードバランサーDNS

### 設定ファイルの利用例（Rails）

```ruby
# config/initializers/aws_resources.rb
require 'yaml'

config_path = Rails.root.join('resource-info/projects', ENV['PROJECT_NAME'], "aws_resources.#{Rails.env}.yml")
AWS_RESOURCES = YAML.load_file(config_path).deep_symbolize_keys

# データベース接続情報の利用
database_url = "postgresql://#{AWS_RESOURCES[:database][:username]}:#{AWS_RESOURCES[:database][:password]}@#{AWS_RESOURCES[:database][:host]}:#{AWS_RESOURCES[:database][:port]}/#{AWS_RESOURCES[:database][:database]}"

# S3の設定
s3_bucket = AWS_RESOURCES[:storage][:bucket_name]
s3_region = AWS_RESOURCES[:storage][:region]

# CloudWatchログの設定
log_group = AWS_RESOURCES[:ecs][:log_group_name]
```

### Rails設定生成時の注意事項

- 設定ファイルにはデータベースパスワードなどの機密情報が含まれるため、バージョン管理から除外することを推奨します
- プロジェクト名は一意である必要があります
- 環境は development、staging、production のいずれかを指定してください
- AWS認証情報が適切に設定されていることを確認してください

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