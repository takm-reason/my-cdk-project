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
├── cdk.json
└── run-cdk.js    # CDK CLI実行スクリプト
```

## インフラサイズの違い

本プロジェクトでは、`infraSize`パラメータにより3種類の環境サイズを提供しています：

### Small環境 (開発/テスト向け)
- **VPC**: 2 AZ構成（パブリック/プライベートサブネット）
- **RDS**: MySQL 8.0 シングルAZ (t3.small)
- **ECS**: Fargate (256 CPU units, 512 MB) x 1
- **Auto Scaling**: なし
- **Redis**: シングルノード (t3.medium)

### Medium環境 (ステージング向け)
- **VPC**: 2 AZ構成（パブリック/プライベート/データベース専用サブネット）
- **RDS**: Aurora MySQL 3.04.0 Serverless v2 (0.5-4 ACU)
- **ECS**: Fargate (512 CPU units, 1024 MB) x 2-8
- **Auto Scaling**: CPU使用率70%
- **Redis**: シングルノード (t3.medium)
- **CloudFront**: Price Class 100
- **WAF**: 基本的な保護ルール

### Large環境 (本番向け)
- **VPC**: 3 AZ構成（パブリック/プライベート/データベース専用サブネット）
- **RDS**: Aurora MySQL 3.04.0 クラスター (r6g.large) x 3
- **ECS**: Fargate (1024 CPU units, 2048 MB) x 3-12
- **Auto Scaling**: CPU使用率70%
- **Redis**: クラスターモード (r6g.large) x 3 (レプリカ: 2)
- **CloudFront**: Price Class 200
- **WAF**: 高度な保護ルール
- **Shield Advanced**: 有効
- **CI/CD**: CodePipeline統合

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
npm run cdk diff -- \
  --context projectName=MyProject \
  --context infraSize=small
```

2. デプロイの実行:
```bash
npm run cdk deploy -- \
  --context projectName=MyProject \
  --context infraSize=small
```

### スタックの削除

```bash
npm run cdk destroy -- \
  --context projectName=MyProject \
  --context infraSize=small
```

### `run-cdk.js`の使用方法

`run-cdk.js`は以下の機能を提供します：

- インフラサイズの検証
- デプロイ前の事前チェック
- 環境変数の自動設定

エラーハンドリング:
- `infraSize`が無効な場合: エラーメッセージを表示し終了
- 必要な環境変数が未設定の場合: 警告を表示
- AWS認証情報が無効な場合: エラーメッセージを表示

### インフラサイズの設定

`infraSize`パラメータ:
- デフォルト値: `small`
- 選択肢: `small`, `medium`, `large`
- 指定方法: `--context infraSize=<サイズ>`

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