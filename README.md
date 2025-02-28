# My CDK Project

このプロジェクトは AWS CDK v2 を使用した TypeScript プロジェクトのテンプレートです。

## プロジェクト構成

```
.
├── bin/
│   └── my-cdk-project.ts    # CDKアプリケーションのエントリーポイント
├── lib/
│   ├── infra-small.ts       # Small環境のインフラ定義
│   ├── infra-medium.ts      # Medium環境のインフラ定義
│   ├── infra-large.ts       # Large環境のインフラ定義
│   └── my-cdk-project-stack.ts    # メインのCDKスタック定義
├── package.json
├── tsconfig.json
└── cdk.json
```

## インフラサイズの違い

本プロジェクトでは、`infraSize`パラメータにより3種類の環境サイズを提供しています：

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

## セットアップ手順

1. 依存関係のインストール:
```bash
npm install
```

2. 資格情報の設定:
AWS認証情報が正しく設定されていることを確認してください。
```bash
aws configure
```

## デプロイ・削除手順

### デプロイ

1. 変更内容の確認:
```bash
cdk diff \
  --context projectName=MyProject \
  --context infraSize=small
```

2. デプロイの実行:
```bash
cdk deploy \
  --context projectName=MyProject \
  --context infraSize=small
```

### スタックの削除

```bash
cdk destroy \
  --context projectName=MyProject \
  --context infraSize=small
```

### インフラサイズの設定

`infraSize`パラメータ:
- デフォルト値: `small`
- 選択肢: `small`, `medium`, `large`
- 指定方法: `--context infraSize=<サイズ>`

### コンテキストパラメータの詳細

デプロイ時に以下のパラメータを指定できます：

#### 必須パラメータ
- **infraSize**:
  - デフォルト値: `small`
  - 選択肢: `small`, `medium`, `large`
  - 説明: インフラストラクチャのサイズを指定

#### オプショナルパラメータ
- **projectName**:
  - デフォルト値: `MyProject`
  - 説明: プロジェクト名（スタック名やリソースタグに使用）

- **domainName**:
  - 説明: Route53で管理されているドメイン名
  - 使用環境: 全環境
  - 例: `example.com`

- **useRoute53** (Small環境用):
  - デフォルト値: `false`
  - 説明: Route53との統合を有効化
  - 必要条件: `domainName`の指定が必要

- **useCustomDomain** (Medium/Large環境用):
  - デフォルト値: `false`
  - 説明: CloudFrontでカスタムドメインを使用
  - 必要条件: `domainName`の指定が必要

#### 使用例
```bash
# Small環境でRoute53統合を有効化する例
cdk deploy \
  --context projectName=MyApp \
  --context infraSize=small \
  --context domainName=example.com \
  --context useRoute53=true

# Medium環境でカスタムドメインを使用する例
cdk deploy \
  --context projectName=MyApp \
  --context infraSize=medium \
  --context domainName=example.com \
  --context useCustomDomain=true
```

## 設定ファイルの概要

### cdk.json

- **app**: エントリーポイントの指定 (`npx ts-node --prefer-ts-exts bin/my-cdk-project.ts`)
- **watch**: ファイル監視の設定（開発時の自動再デプロイ用）
- **context**: CDKの動作設定
  - セキュリティ関連の設定
  - サービス固有の設定
  - リージョン/パーティションの設定

### tsconfig.json

- **Target**: ES2020
- **Module**: CommonJS
- **Strict Mode**: 有効
- **Source Map**: インライン生成
- **出力先**: `dist`ディレクトリ
- **型定義**: `node_modules/@types`を参照

## 主な機能

- コンテキストパラメータ `projectName` を使用してスタック名をカスタマイズ可能
- TypeScriptによる型安全な実装
- モジュール化された構造で拡張性が高い
- 環境サイズに応じた柔軟なインフラ構成

## 注意事項

- デプロイ前に必ず `cdk diff` コマンドで変更内容を確認することをお勧めします
- 本番環境（large）へのデプロイ時は、十分なテストを行ってください
- インフラサイズの変更は、新しい環境への移行を伴うため慎重に計画してください