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

## Railsアプリケーションへの接続情報の受け渡し

### 環境変数の設定方法

#### 開発環境 (dev)
```bash
# デプロイ後に自動生成される.envファイル例
DATABASE_HOST=xxx.xxx.rds.amazonaws.com
DATABASE_PORT=3306
DATABASE_NAME=appdb
DATABASE_USERNAME=admin
DATABASE_PASSWORD=xxx
REDIS_ENDPOINT=xxx.xxx.cache.amazonaws.com
REDIS_PORT=6379
REDIS_AUTH_TOKEN=xxx
RAILS_ENV=development
```

#### 検証・本番環境
ECSタスク定義での環境変数設定例：
```typescript
taskDefinition.addContainer('AppContainer', {
  // ...
  secrets: {
    DATABASE_USERNAME: ecs.Secret.fromSecretsManager(databaseSecret, 'username'),
    DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
    REDIS_AUTH_TOKEN: ecs.Secret.fromSecretsManager(redisSecret),
  },
  environment: {
    DATABASE_HOST: database.instanceEndpoint.hostname,
    DATABASE_PORT: database.instanceEndpoint.port.toString(),
    DATABASE_NAME: 'appdb',
    RAILS_ENV: 'production',
  },
});
```

## リソース情報の出力

### CDK Outputsの使用

デプロイ時に以下のコマンドを使用してリソース情報を取得できます：
```bash
cdk deploy --outputs-file ./outputs/my-stack-outputs.json
```

出力例：
```json
{
  "MyStack": {
    "VpcId": "vpc-0123456789abcdef0",
    "DatabaseEndpoint": "xxx.xxx.rds.amazonaws.com",
    "DatabaseSecretArn": "arn:aws:secretsmanager:region:account:secret:xxx",
    "RedisEndpoint": "xxx.xxx.cache.amazonaws.com",
    "RedisSecretArn": "arn:aws:secretsmanager:region:account:secret:xxx",
    "LoadBalancerDNS": "xxx.elb.amazonaws.com"
  }
}
```

[以下、既存のREADMEの内容が続きます...]

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

[元のREADMEの残りの内容...]