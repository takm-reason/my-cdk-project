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
小規模なアプリケーション向けの構成です。
* 定義ファイル: `lib/small-scale-stack.ts`
* 実装予定の内容はこれから定義されます

### 中規模構成 (Medium Scale)
中規模なアプリケーション向けの構成です。
* 定義ファイル: `lib/medium-scale-stack.ts`
* 実装予定の内容はこれから定義されます

### 大規模構成 (Large Scale)
大規模なアプリケーション向けの構成です。
* 定義ファイル: `lib/large-scale-stack.ts`
* 実装予定の内容はこれから定義されます

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