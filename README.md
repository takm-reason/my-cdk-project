# My CDK Project

このプロジェクトは AWS CDK v2 を使用した TypeScript プロジェクトのテンプレートです。

## プロジェクト構成

```
.
├── bin/
│   └── my-cdk-project.ts    # CDKアプリケーションのエントリーポイント
├── lib/
│   └── my-cdk-project-stack.ts    # メインのCDKスタック定義
├── package.json
├── tsconfig.json
├── cdk.json
└── run-cdk.js    # CDK CLI実行スクリプト
```

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

## デプロイ方法

1. CDKアプリケーションをデプロイ:
```bash
npm run cdk -- deploy --context projectName=MyProject
```

2. スタックの破棄:
```bash
npm run cdk -- destroy --context projectName=MyProject
```

## 主な機能

- コンテキストパラメータ `projectName` を使用してスタック名をカスタマイズ可能
- TypeScriptによる型安全な実装
- モジュール化された構造で拡張性が高い

## 注意事項

- デプロイ前に必ず `cdk diff` コマンドで変更内容を確認することをお勧めします
- 本番環境へのデプロイ時は、十分なテストを行ってください