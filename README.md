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
- Aurora PostgreSQL Serverless v2
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

### 初期セットアップ
```bash
# 依存パッケージのインストール
npm install

# AWS CDKの初期化（アカウントごとに初回のみ必要）
cdk bootstrap
```

### Railsアプリケーションのデプロイ手順

#### 1. Dockerファイルの準備
```Dockerfile
# syntax = docker/dockerfile:1

# Make sure RUBY_VERSION matches the Ruby version in .ruby-version
ARG RUBY_VERSION=3.3.5
FROM docker.io/library/ruby:$RUBY_VERSION-slim AS base

# Rails app lives here
WORKDIR /rails

# Install base packages
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl libjemalloc2 libvips postgresql-client && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Set production environment
ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development" \
    RAILS_SERVE_STATIC_FILES="true" \
    RAILS_LOG_TO_STDOUT="true"

# Build stage
FROM base AS build

# Install packages needed to build gems
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git pkg-config libpq-dev && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Install application gems
COPY Gemfile Gemfile.lock ./
RUN bundle install && \
    rm -rf ~/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    bundle exec bootsnap precompile --gemfile

# Copy application code
COPY . .

# Precompile bootsnap code for faster boot times
RUN bundle exec bootsnap precompile app/ lib/

# Precompiling assets for production without requiring secret RAILS_MASTER_KEY
RUN SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile

# Final stage for app image
FROM base

# Copy built artifacts: gems, application
COPY --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --from=build /rails /rails

# Run as non-root user for security
RUN groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash && \
    chown -R rails:rails db log storage tmp
USER 1000:1000

# ECSタスク定義のメモリ制限に合わせた最適化
ENV RUBY_YJIT_ENABLE=1 \
    MALLOC_ARENA_MAX=2 \
    RAILS_MAX_THREADS=5

# Entrypoint prepares the database.
ENTRYPOINT ["/rails/bin/docker-entrypoint"]

# Start the server by default, this can be overwritten at runtime
EXPOSE 80
CMD ["./bin/rails", "server", "-p", "80", "-b", "0.0.0.0"]
```

#### 2. ECRリポジトリの作成とイメージのプッシュ
```bash
# ECRリポジトリ作成
aws ecr create-repository --repository-name rails-app

# Dockerイメージのビルドとプッシュ
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin [アカウントID].dkr.ecr.ap-northeast-1.amazonaws.com
docker build -t rails-app .
docker tag rails-app:latest [アカウントID].dkr.ecr.ap-northeast-1.amazonaws.com/rails-app:latest
docker push [アカウントID].dkr.ecr.ap-northeast-1.amazonaws.com/rails-app:latest
```

#### 3. ECS設定の更新
以下のように`small-scale-stack.ts`のタスク定義を更新します：
```typescript
taskImageOptions: {
    image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, 'RailsRepo', 'rails-app'),
        'latest'
    ),
    environment: {
        DATABASE_URL: `postgresql://${databaseInstance.instanceEndpoint.hostname}:5432/app`,
        S3_BUCKET: staticFilesBucket.bucketName,
        RAILS_ENV: 'production',
        RAILS_SERVE_STATIC_FILES: 'true',
        RAILS_LOG_TO_STDOUT: 'true'
    },
    containerPort: 3000
}
```

#### 4. データベースのセットアップ
```bash
# データベース作成とマイグレーション用のタスク実行
aws ecs run-task \
    --cluster SmallScaleCluster \
    --task-definition rails-setup \
    --network-configuration "awsvpcConfiguration={subnets=[プライベートサブネットID],securityGroups=[セキュリティグループID]}" \
    --launch-type FARGATE \
    --command "bundle,exec,rails,db:create,db:migrate"
```

#### 5. デプロイと確認
```bash
# スタックのデプロイ
cdk deploy SmallScaleStack

# デプロイ後の確認事項
- ロードバランサーのDNS名にアクセスしてアプリケーションの動作確認
- CloudWatchログでアプリケーションログの確認
- RDSへの接続状態の確認
- S3への静的ファイルアップロードの確認
```

### デプロイ作業

#### 開発時の作業フロー
```bash
# 1. スタックの変更内容確認
cdk diff SmallScaleStack

# 2. ユニットテストの実行
npm run test

# 3. デプロイの実行
cdk deploy SmallScaleStack
```

#### 環境別のデプロイ
```bash
# 開発環境へのデプロイ
cdk deploy SmallScaleStack -c environment=dev

# 本番環境へのデプロイ
cdk deploy SmallScaleStack -c environment=prod

# 確認なしでデプロイ（CI/CD環境用）
cdk deploy SmallScaleStack --require-approval never
```

### 運用管理

#### リソース情報の確認
```bash
# スタックの出力値を確認
cdk list-outputs SmallScaleStack

# 作成されたリソースの一覧を確認
cdk list-resources SmallScaleStack
```

#### スタックの削除
```bash
# スタックの削除（確認あり）
cdk destroy SmallScaleStack

# スタックの強制削除（確認なし）
cdk destroy SmallScaleStack --force
```

**注意事項：**
- S3バケットは保持ポリシーが`RETAIN`に設定されているため、手動削除が必要
- 削除前にS3バケット内のオブジェクトを空にする必要あり
- RDSの自動バックアップは自動的に削除される設定

### トラブルシューティング

#### よくある問題と解決方法
```bash
# 依存関係の再インストール
npm ci

# キャッシュのクリア
cdk context --clear

# CloudFormationスタックの状態確認
aws cloudformation describe-stacks --stack-name SmallScaleStack
```

## リソース情報の保存

デプロイ時に作成されたリソースの情報は`resource-info`ディレクトリに自動保存されます：
- ファイル名形式：`{プロジェクト名}-{タイムスタンプ}.json`
- 保存される情報：リソースARN、エンドポイント、設定値など

## タグ付け

すべてのリソースに以下のタグを付与します：

- Project: プロジェクト名（デプロイ時指定）  
- Environment: `production` / `staging` / `development` のみ  
- CreatedBy: `terraform` / `cloudformation` / `cdk` / `manual` のみ  
- CreatedAt: 作成日（YYYY-MM-DD）  

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