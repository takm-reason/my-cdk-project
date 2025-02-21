# AWS CDK Infrastructureプロジェクト

このプロジェクトは、AWS CDKを使用して異なる規模のインフラストラクチャをコードとして管理するためのテンプレートです。

## 機能

- 3つのスケール（小規模、中規模、大規模）に対応
- リソース情報の自動記録
- 統一的なタグ付け
- プロジェクトごとの分離

## スケール別の構成

### 小規模構成（small）
- VPC（2 AZ、NAT Gateway x1）
- RDS PostgreSQL（Single-AZ）
- S3バケット
- ECS Fargate（Auto Scaling: 1-2台）

### 中規模構成（medium）
- VPC（3 AZ、NAT Gateway x2）
- Aurora MySQL Serverless v2
- ElastiCache Redis
- S3バケット
- CloudFront
- WAF
- ECS Fargate（Auto Scaling: 2-5台）

### 大規模構成（large）
- VPC（3 AZ、NAT Gateway x3）
- Aurora PostgreSQL Global Database
- ElastiCache Redisクラスター（マルチAZ）
- S3バケット（インテリジェント階層化）
- CloudFront + Shield Advanced
- WAF（カスタムルール）
- ECS Fargate（API: 10-50台、Frontend: 10-30台）
- CI/CDパイプライン
- CloudWatchダッシュボード
- Systems Manager Parameter Store

## 使用方法

### プロジェクトのセットアップ

```bash
npm install
```

### デプロイ

スケールとプロジェクト名を指定してデプロイ：

```bash
cdk deploy -c scale=<small|medium|large> -c project=<project-name>
```

例：
```bash
cdk deploy -c scale=small -c project=example-project
```

### リソース情報

デプロイ時に作成されたリソースの情報は`resource-info`ディレクトリに保存されます。
ファイル名形式：`{プロジェクト名}-{タイムスタンプ}.json`

## タグ付け

すべてのリソースには以下のタグが付与されます：
- Project: プロジェクト名
- Scale: スケールタイプ（small/medium/large）
- Name: リソース固有の識別名（{プロジェクト名}-{スケール}-{リソース種別}）

## 開発用コマンド

```bash
# テスト実行
npm run test

# スタックの差分確認
cdk diff -c scale=<small|medium|large> -c project=<project-name>

# スタックの削除
cdk destroy -c scale=<small|medium|large> -c project=<project-name>
```

## セキュリティ

- すべてのデータベースは隔離されたサブネットに配置
- すべてのS3バケットでSSL強制
- WAFによるWebアプリケーション保護
- 大規模構成ではShield Advancedによる追加保護

## 監視

- CloudWatchメトリクスによる自動監視
- 大規模構成では包括的なダッシュボード
- ECSコンテナインサイトの有効化
- Auto Scalingメトリクスの監視

## コスト最適化

- 小規模：最小限のリソースで運用
- 中規模：Serverlessコンポーネントの活用
- 大規模：インテリジェント階層化とキャパシティ最適化

## 注意事項

- プロジェクト名は一意である必要があります
- 異なるスケール間での直接的な連携は想定していません
- スケールの変更は新しいスタックとしてデプロイすることを推奨します

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。