# AWS CDK Infrastructureプロジェクト

このプロジェクトは、AWS CDKを使用して異なる規模のインフラストラクチャをコードとして管理するためのテンプレートです。ビルダーパターンを採用し、インフラストラクチャの構築を容易にしています。

## 機能

- 3つのスケール（小規模、中規模、大規模）に対応
- ビルダーパターンによる再利用可能なインフラ構築
- リソース情報の自動記録
- 統一的なタグ付け
- プロジェクトごとの分離

## ビルダーパターン

### 利用可能なビルダー

- **VpcBuilder**: VPCとサブネットの構築
- **DbBuilder**: RDS/Auroraデータベースの構築
- **CacheBuilder**: ElastiCacheの構築
- **EcsBuilder**: ECSクラスターとサービスの構築
- **S3Builder**: S3バケットの構築
- **CdnBuilder**: CloudFrontディストリビューションの構築
- **WafBuilder**: WAFの構築
- **SecurityGroupBuilder**: セキュリティグループの構築

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
- WAF
- ECS Fargate（Auto Scaling: 2-5台）

### 大規模構成（large）
- VPC（3 AZ、NAT Gateway x3）
- Aurora PostgreSQL Global Database
- ElastiCache Redisクラスター（マルチAZ）
- S3バケット（インテリジェント階層化）
- CloudFront + Shield Advanced
- WAF（カスタムルール）
- ECS Fargate（API: 10-50台、Frontend: 10-30台）
- CI/CDパイプライン
- CloudWatchダッシュボード
- Systems Manager Parameter Store

## CI/CD設定

### GitHub Actions設定手順

#### 1. 必要なシークレット

以下のシークレットをGitHub Repositoryの Settings > Secrets and variables > Actions で設定してください：

```
AWS_ROLE_ARN: arn:aws:iam::{アカウントID}:role/GitHubActionsRole
SLACK_CHANNEL_ID: CxxxxxxxxxxxxxxxxX
SLACK_BOT_TOKEN: xoxb-xxxxxxxxxxxxx-xxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
CODECOV_TOKEN: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

#### 2. AWS IAMロールの設定

1. IAMロールの作成
```bash
# Trust Relationship (信頼ポリシー)の作成
cat > trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::{アカウントID}:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": "repo:{組織名}/{リポジトリ名}:*"
                }
            }
        }
    ]
}
EOF
```

## 使用方法

### 初期セットアップ
```bash
# 依存パッケージのインストール
npm install

# AWS CDKの初期化（アカウントごとに初回のみ必要）
cdk bootstrap
```

### デプロイ作業

#### 開発時の作業フロー
```bash
# 1. スタックの変更内容確認
cdk diff SmallScaleStack

# 2. ユニットテストの実行
npm run test

# 3. デプロイの実行
cdk deploy SmallScaleStack
```

#### 環境別のデプロイ
```bash
# 開発環境へのデプロイ
cdk deploy SmallScaleStack -c environment=dev

# 本番環境へのデプロイ
cdk deploy SmallScaleStack -c environment=prod

# 確認なしでデプロイ（CI/CD環境用）
cdk deploy SmallScaleStack --require-approval never
```

## エラーハンドリング

### エラーコード一覧

```typescript
const ERROR_CODES = {
    'CDK001': 'スタックの依存関係エラー',
    'CDK002': 'リソース制限エラー',
    'CDK003': 'パラメータ検証エラー',
};
```

### エラーハンドリング例

```typescript
try {
    await stack.deploy();
} catch (error) {
    if (error.code === 'CDK001') {
        // 依存関係の修正
        await fixDependencies();
    } else if (error.code === 'CDK002') {
        // リソース制限の確認
        await checkResourceLimits();
    } else {
        // その他のエラー処理
        console.error('予期せぬエラー:', error);
    }
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