# test-project AWS Environment

Generated at: Invalid Date

## 構成情報

- RDS Endpoint: ${Token[TOKEN.5317]}
- S3 Bucket: ${Token[TOKEN.5343]}
- Load Balancer: ${Token[TOKEN.5469]}

## ファイル構成

```
test-project/
├── rails/
│   └── config.yml  # Railsアプリケーションの設定ファイル
└── aws/
    ├── resources.yml  # AWSリソース情報
    └── raw-data.json  # 詳細なリソース情報（デバッグ用）
```

## Railsプロジェクトへの設定適用

1. `rails/config.yml` を Rails プロジェクトの `config/` ディレクトリにコピー
2. 以下の項目を設定：
   - `rails.master_key`
   - `database.password`

## 詳細情報の参照

AWS環境の詳細情報は `aws/resources.yml` を参照してください。
