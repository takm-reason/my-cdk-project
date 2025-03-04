# AWS インフラストラクチャテンプレート

AWS CDKを使用したマルチ環境インフラストラクチャのテンプレートプロジェクトです。

## プロジェクトの概要

このプロジェクトは、AWS上にスケーラブルで安全なインフラストラクチャを構築するためのテンプレートを提供します。
開発環境から本番環境まで、異なるニーズに対応できる柔軟な構成が可能です。

## 機能一覧

- ✅ マルチAZ構成
- ✅ オートスケーリング
- ✅ 暗号化とセキュリティ
- ✅ 監視とアラート
- ✅ バックアップと復旧
- ✅ コスト最適化

## アーキテクチャ

本プロジェクトは以下のAWSサービスを使用します：

- **コンピューティング**: Amazon ECS (Fargate)
- **データベース**: Amazon RDS (Aurora)
- **キャッシュ**: Amazon ElastiCache (Redis)
- **ネットワーク**: Amazon VPC
- **セキュリティ**: AWS WAF, AWS Shield
- **監視**: Amazon CloudWatch
- **CI/CD**: AWS CodePipeline

## 環境構成

### インフラストラクチャのサイズ

各環境は、要件に応じて3つのサイズから選択できます：

#### Small構成（小規模）
- 開発環境や小規模な本番環境向け
- ECS: 単一タスク、最小限のスケーリング
- RDS: シングルインスタンス（削除保護なし）
- Redis: シングルノード
- 削除ポリシー: DESTROY（開発環境）

#### Medium構成（中規模）
- ステージング環境や中規模な本番環境向け
- ECS: 2台以上のタスクとオートスケーリング
- RDS: Aurora Serverless v2（削除保護あり）
- Redis: 2ノードレプリケーション
- 削除ポリシー: 検証環境はDESTROY、本番環境はRETAIN

#### Large構成（大規模）
- 大規模な本番環境向け
- ECS: 3台以上のタスクと高度なオートスケーリング
- RDS: Auroraクラスターとレプリカ（削除保護あり）
- Redis: 3シャード構成（レプリカ付き）
- 削除ポリシー: RETAIN

### 環境タイプ

- **開発環境（dev）**: 開発用の小規模構成
- **ステージング環境（staging）**: 検証用の中規模構成
- **本番環境（prod）**: 本番用の可変サイズ構成

## Railsアプリケーションとの統合

### 環境変数の設定方法

#### 開発環境（dev）
開発環境では簡易的な方法で環境変数を設定します：

```bash
# デプロイ後に環境変数ファイルを生成
cdk deploy --context env=dev --outputs-file ./config/dev-outputs.json

# 生成されたJSONから環境変数を設定
cat > .env.development << EOF
RAILS_ENV=development
DATABASE_HOST=$(jq -r '.["MyStack"].DatabaseEndpoint' config/dev-outputs.json)
DATABASE_PORT=$(jq -r '.["MyStack"].DatabasePort' config/dev-outputs.json)
DATABASE_NAME=appdb
# 他の環境変数も同様に設定
EOF
```

#### ステージング/本番環境
セキュリティを考慮した環境変数の設定：

```yaml
# ECSタスク定義での環境変数設定
environment:
  - name: RAILS_ENV
    value: production
  - name: DATABASE_HOST
    value: !Ref DatabaseEndpoint
  
secrets:
  - name: DATABASE_PASSWORD
    valueFrom: !Ref DatabaseSecretArn
  - name: REDIS_AUTH_TOKEN
    valueFrom: !Ref RedisSecretArn
```

### 接続情報の管理

#### 開発環境
- 環境変数を`.env`ファイルで管理
- データベースパスワードもファイルで管理可能
- Git管理外に置くことを推奨

#### ステージング/本番環境
- AWS Secrets Managerで認証情報を管理
- ECSタスク定義で`secrets`として参照
- 環境変数には機密情報を含めない

## リソース情報の出力と管理

### CDK Outputsの使用方法

```bash
# リソース情報をJSONファイルとして出力
cdk deploy --context env=<環境名> --outputs-file ./outputs/<環境名>-outputs.json

# 出力例
{
  "MyStack": {
    "VpcId": "vpc-xxxxxxxx",
    "DatabaseEndpoint": "xxx.rds.amazonaws.com",
    "RedisEndpoint": "xxx.cache.amazonaws.com",
    "LoadBalancerDNS": "xxx.elb.amazonaws.com"
  }
}
```

### 出力情報の利用

```ruby
# config/database.yml
production:
  host: <%= ENV['DATABASE_HOST'] %>
  port: <%= ENV['DATABASE_PORT'] %>
  database: <%= ENV['DATABASE_NAME'] %>
  username: <%= ENV['DATABASE_USERNAME'] %>
  password: <%= ENV['DATABASE_PASSWORD'] %>
```

## 削除ポリシーとバックアップ

### 環境別のポリシー

#### 開発環境（dev）
- **削除ポリシー**: `DESTROY`
- **削除保護**: 無効
- **バックアップ**: 最小限（7日間）
- コスト最適化重視

#### ステージング環境（staging）
- **削除ポリシー**: `DESTROY`
- **削除保護**: 任意
- **バックアップ**: 14日間
- 柔軟な環境管理重視

#### 本番環境（prod）
- **削除ポリシー**: `RETAIN`
- **削除保護**: 有効
- **バックアップ**: 30日間以上
- データ保護重視

## セキュリティ対策

- すべてのデータベースとキャッシュは保存時に暗号化
- 機密情報はAWS Secrets Managerで管理
- ネットワークアクセスはセキュリティグループで制限
- 通信の暗号化（SSL/TLS）を実施

## 監視とアラート

- CloudWatchによるメトリクス監視
- アラートの自動通知設定
- ログの集中管理
- パフォーマンス監視

## バックアップと復旧

- RDSの自動バックアップ
- S3バケットのバージョニング
- 定期的なスナップショット
- 障害復旧手順の整備

## コスト管理

- リソースの自動スケーリング
- 開発環境の自動停止
- コスト最適化レポート
- 予算アラートの設定

## その他の機能

- マルチAZ構成によるHA対策
- エッジロケーションの活用
- CI/CDパイプラインの統合
- アプリケーションのブルー/グリーンデプロイ

## 注意事項

1. デプロイ前に必ず環境変数を設定してください
2. 本番環境へのデプロイは慎重に行ってください
3. コストを監視し、不要なリソースは削除してください
4. セキュリティアップデートは定期的に適用してください

## リソースの削除

環境を削除する場合は以下のコマンドを実行します：

```bash
cdk destroy --context env=<環境名>
```

## プロジェクトの構成

```
.
├── bin/
│   └── my-cdk-project.ts      # エントリーポイント
├── lib/
│   ├── infra-base-stack.ts    # 基本設定
│   ├── infra-environments.ts  # 環境設定
│   ├── infra-small.ts        # 小規模構成
│   ├── infra-medium.ts       # 中規模構成
│   └── infra-large.ts        # 大規模構成
└── scripts/
    └── get-secrets.ts        # シークレット管理
```

## ライセンス

このプロジェクトはMITライセンスの下で提供されています。