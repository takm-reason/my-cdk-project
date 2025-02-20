# My CDK Project

このプロジェクトはAWS CDKを使用したインフラストラクチャのコード化（IaC）プロジェクトです。小規模、中規模、大規模の各構成に対応しています。

## 前提条件

* Node.js (v18.x以降)
* AWS CLI（設定済み）
* AWS CDK CLI (`npm install -g aws-cdk`)

## セットアップ

プロジェクトをセットアップするには以下のコマンドを実行してください：

```bash
# 依存パッケージのインストール
npm install

# TypeScriptのビルド
npm run build

# CDKアプリケーションの初期化（初回のみ）
cdk bootstrap

# スタックの差分確認
cdk diff

# スタックのデプロイ
cdk deploy
```

## プロジェクト構造

```
.
├── bin/
│   └── my-cdk-project.ts    # CDKアプリケーションのエントリーポイント
├── lib/
│   ├── small-scale-stack.ts     # 小規模構成のスタック定義
│   ├── medium-scale-stack.ts    # 中規模構成のスタック定義
│   └── large-scale-stack.ts     # 大規模構成のスタック定義
├── test/
│   └── my-cdk-project.test.ts   # テストコード
├── cdk.json                 # CDK設定ファイル
├── tsconfig.json           # TypeScript設定
├── jest.config.js         # Jestテスト設定
├── package.json          # プロジェクト依存関係
└── README.md            # このファイル
```

## スケール構成の選択とデプロイ

このプロジェクトは3つのスケール構成（小規模、中規模、大規模）と3つのステージ（開発、ステージング、本番）をサポートしています。

### 環境変数

- `SCALE`: デプロイするスケールサイズを指定
  - `small`: 小規模構成
  - `medium`: 中規模構成
  - `large`: 大規模構成

- `STAGE`: デプロイ環境を指定
  - `dev`: 開発環境
  - `staging`: ステージング環境
  - `prod`: 本番環境

### デプロイ例

```bash
# 開発環境に小規模構成をデプロイ
SCALE=small STAGE=dev cdk deploy

# ステージング環境に中規模構成をデプロイ
SCALE=medium STAGE=staging cdk deploy

# 本番環境に大規模構成をデプロイ
SCALE=large STAGE=prod cdk deploy
```

### 差分確認例

```bash
# 本番環境の大規模構成の差分を確認
SCALE=large STAGE=prod cdk diff
```

## スケール構成の詳細

### 小規模構成 (Small Scale)
シンプルで効率的な小規模アプリケーション向けの構成です。

* 定義ファイル: `lib/small-scale-stack.ts`
* 想定ユーザー規模：月間アクティブユーザー1,000人以下
* 概算コスト：月額 $100-200 程度
  - ECS Fargate (1-2タスク): $30-60
  - RDS (t4g.micro): $25
  - ALB: $20
  - S3: $1-5
  - その他 (データ転送など): $20-30
* 主な特徴：
  - **ECS (Fargate)**
    - 1〜2タスク
    - 基本的に固定スケール（必要に応じて軽いAuto Scaling）
    - Monolithicなアプリケーションアーキテクチャをサポート
  - **ALB (Application Load Balancer)**
    - 単一のパブリックALB
    - ECS Fargateのターゲットグループに紐付け
    - HTTP/HTTPSリスナー設定
  - **RDS (Single-AZ)**
    - インスタンスタイプ: t4g.micro / t4g.small
    - シングルAZで運用
    - 必要に応じてAurora Serverless v2への移行も可能
  - **S3**
    - 画像・静的ファイルの保存用
    - シンプルな構成（CloudFrontなし）

### 中規模構成 (Medium Scale)
成長するアプリケーション向けの拡張性と可用性を備えた構成です。

* 定義ファイル: `lib/medium-scale-stack.ts`
* 想定ユーザー規模：月間アクティブユーザー1,000-10,000人
* 概算コスト：月額 $500-1,000 程度
  - ECS Fargate (2-5タスク): $100-250
  - Aurora Serverless v2: $200-300
  - ElastiCache: $50
  - ALB: $20
  - CloudFront + S3: $50-100
  - WAF: $50
  - その他 (データ転送など): $100-200
* 主な特徴：
  - **ECS (Fargate) + Auto Scaling**
    - 2〜5タスク（負荷に応じて自動スケール）
    - CPU/メモリ使用率に基づくAuto Scaling
    - 複数AZにタスクを配置
  - **ALB (Application Load Balancer)**
    - 複数AZにタスクを分散配置
    - 複数のターゲットグループ（APIとWebの分離）
  - **Aurora Serverless v2**
    - 自動スケーリング機能
    - マルチAZ構成で高可用性を確保
  - **ElastiCache (Redis)**
    - セッション管理とキャッシュ用途
    - インスタンスタイプ: cache.t4g.small〜medium
  - **S3 + CloudFront**
    - 静的コンテンツの配信最適化
    - グローバルなエッジキャッシュの活用
  - **WAF**
    - 基本的なセキュリティ保護
    - SQLインジェクションやDDoS対策

### 大規模構成 (Large Scale)
高可用性、高性能、グローバル展開に対応した大規模アプリケーション向けの構成です。

* 定義ファイル: `lib/large-scale-stack.ts`
* 想定ユーザー規模：月間アクティブユーザー10,000人以上
* 概算コスト：月額 $3,000-10,000以上
  - ECS Fargate (10-50タスク): $500-2,500
  - Aurora (r6g.large x 3): $1,000-1,500
  - ElastiCache Cluster: $500-1,000
  - 複数ALB: $100
  - CloudFront + S3: $200-500
  - WAF + Shield Advanced: $3,000
  - CI/CD + 監視: $100-200
  - その他 (データ転送など): $500-1,000
* 主な特徴：
  - **ECS (Fargate) + 大規模Auto Scaling**
    - 10〜50タスク（負荷に応じて自動スケール）
    - 複数AZにまたがる配置
    - マイクロサービスアーキテクチャをサポート
  - **複数のALB**
    - APIとフロントエンド用の個別ALB
    - 高度なルーティング設定
    - 大規模トラフィックへの対応
  - **Aurora + Read Replica**
    - インスタンスタイプ: r6g.large以上
    - 読み書き分離による負荷分散
    - グローバルデータベース対応
  - **ElastiCache (Redis Cluster)**
    - クラスターモードによる水平スケーリング
    - 大規模セッション管理とキャッシュ
    - インスタンスタイプ: cache.r6g.large以上
  - **S3 + CloudFront + Shield**
    - グローバルコンテンツ配信
    - 大規模データ転送の最適化
    - DDoS保護
  - **統合監視とCI/CD**
    - CloudWatch詳細モニタリング
    - 自動デプロイパイプライン
    - Systems Managerによる構成管理

## 開発ガイド

### 新しいリソースの追加

1. 適切なスケール構成のスタックファイルを選択
2. リソースを追加
3. 必要に応じてテストを追加
4. `npm run build`でコンパイル
5. `cdk diff`で変更内容を確認
6. `cdk deploy`でデプロイ

## セキュリティのベストプラクティス

1. 認証情報の管理
   * AWSクレデンシャルを適切に管理
   * シークレットはAWS Secrets Managerを使用
   * 環境変数での機密情報の受け渡しは避ける

2. ネットワークセキュリティ
   * VPCのサブネット設計を適切に行う
   * セキュリティグループの設定は必要最小限に
   * パブリックアクセスが必要なリソースのみパブリックサブネットに配置

3. その他
   * IAMポリシーは最小権限の原則に従う
   * 本番環境へのデプロイ前に`cdk diff`で変更内容を必ず確認
   * 重要なリソースには削除保護を設定

## トラブルシューティング

一般的な問題と解決方法：

1. デプロイエラー
   * AWSクレデンシャルの確認
   * `cdk bootstrap`の実行確認
   * CloudFormationコンソールでエラー詳細確認

2. TypeScriptエラー
   * `npm install`での依存パッケージ確認
   * `tsconfig.json`の設定確認
   * `npm run build`でのコンパイルエラー確認

3. 環境変数関連
   * `SCALE`と`STAGE`が正しく設定されているか確認
   * AWS認証情報が正しく設定されているか確認

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。