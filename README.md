# My CDK Project

このプロジェクトはAWS CDKを使用したインフラストラクチャのコード化（IaC）プロジェクトです。小規模、中規模、大規模の各構成に対応しています。

## 前提条件

* Node.js (v18.x以降)
* AWS CLI（設定済み）
* AWS CDK CLI (`npm install -g aws-cdk`)

## プロジェクト構造

```
.
├── bin/
│   └── my-cdk-project.ts    # CDKアプリケーションのエントリーポイント
├── lib/
│   ├── infra-base-stack.ts  # 基本インフラ定義（Secrets Manager等）
│   ├── infra-small.ts       # Small環境のインフラ定義
│   ├── infra-medium.ts      # Medium環境のインフラ定義
│   ├── infra-large.ts       # Large環境のインフラ定義
│   └── my-cdk-project-stack.ts    # メインのCDKスタック定義
├── scripts/
│   └── get-secrets.ts       # シークレット取得スクリプト
├── test/
│   └── my-cdk-project.test.ts   # テストコード
├── cdk.json                 # CDK設定ファイル
├── tsconfig.json           # TypeScript設定
├── jest.config.js         # Jestテスト設定
├── package.json          # プロジェクト依存関係
└── README.md            # このファイル
```

## 認証情報とシークレットの管理

### AWS Secrets Manager

本プロジェクトでは、データベースやRedisの認証情報を AWS Secrets Manager で管理しています。

#### 自動生成されるシークレット

1. **データベース認証情報**:
   ```json
   {
     "username": "admin",
     "password": "自動生成されたパスワード",
     "dbname": "appdb"
   }
   ```

2. **Redis認証情報**:
   ```json
   {
     "authToken": "自動生成されたトークン"
   }
   ```

### 環境別の認証情報管理

#### 開発環境 (dev)
- シンプルな認証情報管理
- `removalPolicy: DESTROY` で環境の削除を容易に
- デプロイ時に自動生成された認証情報を.envファイルとして出力

#### 検証環境 (staging)
- Secrets Managerで認証情報を管理
- ECSタスク定義でのシークレット参照
- `removalPolicy: DESTROY` で環境の削除を可能に

#### 本番環境 (small/medium/large)
- Secrets Managerによる厳格な認証情報管理
- `removalPolicy: RETAIN` でシークレットを保護
- IAMロールベースのアクセス制御

## 開発用ツール

### シークレット取得スクリプト

開発環境で使用するシークレット値を安全に取得し、.env形式で出力するスクリプトを提供しています。

```bash
# 基本的な使用方法
npm run get-secrets MyProject dev .env.local

# 使用例（開発環境の場合）
npm run get-secrets MyProject dev .env.development

# 使用例（検証環境の場合）
npm run get-secrets MyProject staging .env.staging
```

出力される.envファイルの例：
```bash
# Database configuration
DATABASE_USERNAME=admin
DATABASE_PASSWORD=xxxxx
DATABASE_NAME=appdb

# Redis configuration
REDIS_AUTH_TOKEN=xxxxx

# Environment
RAILS_ENV=development
```

⚠️ **注意事項**:
- 生成された.envファイルには機密情報が含まれるため、必ず.gitignoreに追加してください
- AWS認証情報が正しく設定されていることを確認してください
- 出力ファイルは、アプリケーションのルートディレクトリに配置することを推奨します

## コンテキストパラメータ

デプロイ時に以下のパラメータを指定できます：

### 必須パラメータ
- **projectName**:
  - プロジェクト名を指定
  - デフォルト値: `MyProject`
  - 例: `--context projectName=MyApp`

- **infraSize**:
  - インフラストラクチャのサイズを指定
  - 選択肢: `small`, `medium`, `large`
  - デフォルト値: `small`
  - 例: `--context infraSize=medium`

### オプショナルパラメータ
- **domainName**:
  - Route53で管理されているドメイン名
  - 例: `--context domainName=example.com`

- **useRoute53** (Small環境用):
  - Route53との統合を有効化
  - デフォルト値: `false`
  - 必要条件: `domainName`の指定が必要

- **useCustomDomain** (Medium/Large環境用):
  - CloudFrontでカスタムドメインを使用
  - デフォルト値: `false`
  - 必要条件: `domainName`の指定が必要

## スケール構成の詳細

### Small環境 (開発/テスト向け)
小規模環境では、基本的なアプリケーション実行に必要な最小限のリソースを提供します：
- **VPC**: 2 AZ構成（パブリック/プライベートサブネット）
- **ECS**: Fargate (256 CPU units, 512 MB) x 1
- **ALB**: Application Load Balancer
- **RDS**: MySQL 8.0 シングルAZ (t3.small)
  - 初期ストレージ: 20GB
  - 最大ストレージ: 30GB
  - バックアップ保持期間: 7日間
- **S3バケット**:
  - バージョニング有効
  - サーバーサイド暗号化 (SSE-S3)
  - パブリックアクセスブロック
  - ライフサイクルルール:
    - 30日後: IA (Infrequent Access)へ移行
    - 90日後: Glacierへ移行
- **DNS**: Route53ホストゾーン統合（オプション）

### Medium環境 (ステージング向け)
中規模環境では、本番環境に近い構成でより堅牢なインフラを提供します：
- **VPC**: 2 AZ構成（パブリック/プライベート/データベース専用サブネット）
- **ECS**: Fargate (512 CPU units, 1024 MB) x 2-8
- **Auto Scaling**: CPU使用率70%でスケーリング
- **RDS**: Aurora MySQL 3.04.0 Serverless v2
  - オートスケーリング: 0.5-4 ACU
  - マルチAZ構成
- **ElastiCache**: Redis シングルノード (t3.medium)
- **CloudFront**: Price Class 100
  - カスタムドメイン対応
  - SSL/TLS証明書統合
- **WAF**: 基本的な保護ルール
  - レートリミット
  - 一般的な攻撃からの保護

### Large環境 (本番向け)
大規模環境では、高可用性と堅牢性を重視した本番運用向けの構成を提供します：
- **VPC**: 3 AZ構成（パブリック/プライベート/データベース専用サブネット）
- **ECS**:
  - メインアプリケーション: Fargate (1024 CPU units, 2048 MB) x 3-12
  - APIサービス: 独立したFargateサービス (1024 CPU units, 2048 MB) x 3-12
  - コンテナヘルスチェック
  - ECSタスク実行ロール
- **ALB**:
  - マルチリスナー構成
  - 複数ターゲットグループ
  - SSL/TLS終端
- **Aurora MySQL**:
  - バージョン: 3.04.0
  - インスタンスタイプ: r6g.large
  - マルチAZ: 3ノード（プライマリ + 2リードレプリカ）
  - 自動バックアップ設定
- **ElastiCache**:
  - Redisクラスターモード
  - インスタンスタイプ: r6g.large
  - 3シャード（各シャードに2レプリカ）
  - 自動フェイルオーバー
- **CloudFront**: Price Class 200
  - エッジロケーション最適化
  - カスタムエラーページ
  - APIキャッシュ戦略
- **セキュリティ**:
  - WAF（高度な保護ルール）
  - AWS Shield Advanced
  - セキュリティグループの厳格な制御
  - KMS暗号化の統合
- **監視とログ管理**:
  - CloudWatch Logs（1ヶ月保持）
  - CloudWatch Metrics
  - カスタムメトリクス
  - アラーム設定
- **システム管理**:
  - AWS Systems Manager
  - パラメータストア
  - セッション管理
- **CI/CD**:
  - CodePipelineによる自動化
  - CodeCommitリポジトリ
  - CodeBuildによるDockerビルド
  - CodeDeployによるECSデプロイ
  - パイプライン失敗時のアラート

## セットアップと使用方法

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 資格情報の設定
AWS認証情報が正しく設定されていることを確認します。
```bash
aws configure
```

### 3. デプロイ

#### 変更内容の確認
```bash
cdk diff \
  --context projectName=MyProject \
  --context infraSize=small
```

#### デプロイの実行
```bash
cdk deploy \
  --context projectName=MyProject \
  --context infraSize=small
```

### 4. スタックの削除
```bash
cdk destroy \
  --context projectName=MyProject \
  --context infraSize=small
```

## セキュリティのベストプラクティス

### 1. シークレット管理
- データベースパスワードやAPIキーは必ずSecrets Managerで管理
- 環境変数での直接指定は避ける
- シークレットの自動ローテーションを検討

### 2. ネットワークセキュリティ
- VPCエンドポイントの活用
- セキュリティグループの最小権限設定
- プライベートサブネットの活用

### 3. 暗号化
- 保管データの暗号化（S3, RDS, ElastiCache）
- 通信の暗号化（HTTPS, TLS）
- KMSカスタマーマネージドキーの使用

### 4. モニタリングとロギング
- CloudWatch Logsの有効化
- VPCフローログの有効化
- CloudTrailの有効化

### 5. コンプライアンス
- タグ付けの一貫性
- リソースの命名規則
- 監査ログの保持

## トラブルシューティング

### 一般的な問題と解決方法

1. デプロイエラー
   * AWSクレデンシャルの確認
   * `cdk bootstrap`の実行確認
   * CloudFormationコンソールでエラー詳細確認

2. TypeScriptエラー
   * `npm install`での依存パッケージ確認
   * `tsconfig.json`の設定確認
   * `npm run build`でのコンパイルエラー確認

3. 環境変数関連
   * コンテキストパラメータが正しく設定されているか確認
   * AWS認証情報が正しく設定されているか確認

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。