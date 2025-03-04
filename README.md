# My CDK Project

このプロジェクトは AWS CDK v2 を使用した TypeScript プロジェクトのテンプレートです。

## プロジェクト構成

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
│   └── get-secrets.ts      # シークレット取得スクリプト
├── package.json
├── tsconfig.json
└── cdk.json
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

## インフラサイズの違い

[以下、既存のインフラサイズの説明が続きます...]

[元のREADMEの残りの内容をここに配置]