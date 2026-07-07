# 共有ファイル管理 (Storage Browser for Amazon S3)

自治体の利用者がファイルを共有するための Web システムです。ファイルの保存先は Amazon S3 で、
認証は AWS Amplify (Gen2) と Amazon Cognito で構成しています。画面は React 製の SPA
(1 つのページの中で表示を切り替える構成) です。個人情報を扱うため、セキュリティを重視しています。

このドキュメントは、**React / AWS Amplify / AWS CDK に詳しくない担当者**でも保守できるように
書いています。日々の運用手順は [docs/operations.md](docs/operations.md) にまとめてあります。

## できること

- Cognito Managed Login (ホスト型のログイン画面) からのサインイン。MFA (認証アプリ) を必須とし、パスキーにも対応
- Storage Browser for S3 によるフォルダとファイルの閲覧 / アップロード / ダウンロード / 削除
- Cognito グループ (admin / dept-a / dept-b) によるフォルダ単位のアクセス制御
- アカウント設定画面からのパスワード変更 / 認証アプリ再設定 / パスキー登録 / 削除
- 監査ログ (CloudTrail / Cognito アクティビティログ / WAF ログ) と脅威保護

## アーキテクチャ (概要)

```
  ブラウザ (利用者)
     │  (1) サインイン (リダイレクト)
     ▼
  Cognito Managed Login  ── WAF (日本以外ブロック / レート制限 / IP レピュテーション)
  auth.storage-browser.www.non-97.net        │
     │  (2) トークン発行                       └─ ログ ▶ CloudWatch Logs
     ▼
  SPA (React / Vite)  ─(3) 一時認証情報─ Cognito Identity Pool
     │                                        (グループ別 IAM ロール)
     │  (4) 署名付きリクエスト
     ▼
  Amazon S3 (SSE-KMS / バージョニング / ライフサイクル)
     │
     └─ データイベント ▶ CloudTrail (SSE-KMS) ▶ 監査ログバケット
```

- フロント (SPA) の URL は、本番が `storage-browser.www.non-97.net`、開発が `http://localhost:5173`
- 認証ドメイン (Managed Login) は `auth.storage-browser.www.non-97.net` (カスタムドメイン)
- リージョンは東京 (ap-northeast-1)。ただし ACM 証明書だけは us-east-1 に置く必要があります

## ディレクトリマップ (どのファイルを編集すると何が変わるか)

| パス | 役割 | 主な用途 |
|---|---|---|
| `amplify/app.config.ts` | **設定値の入口**。ドメイン / 証明書 / ホストゾーン / ライフサイクル日数 / WAF レート制限 / 通知 SES ID | 環境固有の値や運用パラメータを変更する |
| `amplify/backend.ts` | バックエンド全体の構成 (どのモジュールを呼び出すか) | リソースを増減する |
| `amplify/auth/resource.ts` | Cognito の基本定義 (ログイン方式 / MFA / グループ) | 認証方式やグループを変更する |
| `amplify/auth/*.ts` | User Pool の強化 / 脅威保護 / Managed Login | 認証まわりの詳細を変更する |
| `amplify/storage/resource.ts` | S3 のパスとアクセス権限 | フォルダ構成や権限を変更する |
| `amplify/storage/bucket-hardening.ts` | S3 の暗号化 / CORS / ライフサイクル | バケットの詳細を変更する |
| `amplify/monitoring/*.ts` | CloudTrail / WAF / ログ | 監視と監査の設定を変更する |
| `amplify/assets/login-logo.png` | ログイン画面のロゴ画像 | ロゴを差し替える (比率 1:1〜4:1) |
| `src/App.tsx` | 画面全体 (認証状態 / ヘッダー / 画面切り替え) | 画面構成を変更する |
| `src/accountSettings/` | アカウント設定画面の各セクション | 設定画面を変更する |
| `src/StorageBrowserView.tsx` | ファイル一覧 (Storage Browser 本体) | 通常は編集しない |
| `src/displayText.ts` | Storage Browser の日本語表示テキスト | 画面の文言を変更する |
| `src/locationHash.ts` | URL とフォルダ位置の変換ロジック (テスト対象) | 通常は編集しない |
| `amplify_outputs.json` | デプロイ結果。自動生成され Git 管理外。**編集しない** | (編集しない) |

## 前提ツール

- Node.js 24 (Amplify Hosting のビルドと同じバージョン)
- pnpm (npm / npx は使いません)
- AWS 認証情報 (`aws sts get-caller-identity` が成功する状態)

## デプロイ前に事前作成が必要なもの (初期構築)

新しい AWS アカウント / 環境でゼロから構築する場合、初回のデプロイ (git push) より前に
以下を順番どおり用意します。作成した値は `amplify/app.config.ts` と
`scripts/setup-custom-domain.sh` に反映します。

### AWS アカウント側 (一度きり)

1. **CDK ブートストラップ (ap-northeast-1)**: `ampx pipeline-deploy` / `ampx sandbox` の前提。
   未実施だとバックエンドのビルドが失敗します
2. **Route53 公開ホストゾーン**: 例 `www.non-97.net`。委任済みであること
3. **ACM 証明書 (us-east-1)**: 認証ドメイン (例 `auth.storage-browser.www.non-97.net`) 用。
   Cognito カスタムドメインは CloudFront に紐づくため、東京ではなく us-east-1 の証明書が必須です
4. **SES ドメイン ID の検証**: 例 `www.non-97.net` (DKIM)。招待 / パスワードリセット /
   脅威保護通知メールの送信元になります
5. **SES 送信認可ポリシー**: 上記 ID に `cognito-idp.amazonaws.com` からの送信を許可する
   ポリシーを付与します。無いと Cognito がメールを送信できません
6. **SES 本番アクセス**: サンドボックスのままだと検証済みアドレスにしか送信できません
7. **ダミー A レコード**: フロントのドメイン (例 `storage-browser.www.non-97.net`) に任意の IP
   (例 8.8.8.8) を指す A レコードを置きます。Cognito カスタムドメインは「親ドメインに有効な
   DNS A レコードがあり IP に解決できること」が作成の前提のためです。値は何でもよいことも含め、
   [Cognito 開発者ガイドの Prerequisites](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-add-custom-domain.html)
   に明記されています。**これを忘れると初回デプロイが失敗します**。
   後で `scripts/setup-custom-domain.sh` が削除し、Amplify のレコードに置き換わります

### GitHub 側

8. リポジトリを作成します (main への push がそのまま本番デプロイになります)
9. **Amplify GitHub App** をリポジトリにインストールします。App はリージョン別なので
   ap-northeast-1 用を入れます (別リージョン用のインストールでは接続に失敗します)

### Amplify 側

10. Amplify アプリを作成してリポジトリと main ブランチを接続し、app-id を
    `scripts/setup-custom-domain.sh` に反映します
11. ビルドインスタンスを **XLARGE_72GB** にします。既定サイズだと Vite 8 のビルドが
    メモリ誤検知で停止します (詳細は [docs/operations.md](docs/operations.md) §11)

### 初回デプロイ後

12. `scripts/setup-custom-domain.sh` を実行し、ダミー A レコードの削除とフロントの
    カスタムドメイン関連付けを行います
13. 利用者を作成します ([docs/operations.md](docs/operations.md) §1)

## セットアップと開発コマンド

```bash
pnpm install                              # 依存関係のインストール

AWS_REGION=ap-northeast-1 pnpm sandbox     # バックエンドを個人用環境へデプロイ (watch モード)
                                          # 初回はここで amplify_outputs.json が生成される
pnpm dev                                  # フロントエンドの開発サーバー (http://localhost:5173)

pnpm test                                 # 単体テスト (vitest)
pnpm lint                                 # 静的解析 (oxlint)
pnpm build                                # 型チェックと本番ビルド
```

- `pnpm sandbox` は、あなた専用の検証用バックエンド環境を AWS 上に作るコマンドです。`amplify/` を監視し、ファイルを保存するたびに自動でデプロイし直します (watch モード)
- 設定値 (`amplify/app.config.ts`) は、書き換えて保存するだけで反映されます
- 設定値が不正なとき (例: ライフサイクルの Standard-IA 移行を 30 日未満にした場合) は、synth の段階でエラーになりデプロイされません

## 設定値の入口

コードの詳細を読まなくても変更できる値は、`amplify/app.config.ts` に集約しています。

- カスタムドメイン: `domainName` / `webAuthnRelyingPartyId` / `certificateId` / `certificateRegion` / `hostedZoneId` / `hostedZoneName`
- セキュリティ: `sesIdentity` / `sesFromAddress` / `sesIdentityRegion` / `appOrigins` / `deletionProtection` / ライフサイクルの日数 / `wafRateLimitPer5Minutes`

なお AWS アカウント ID は CDK が実行時に取得するため、このファイルには持たせていません。

## テスト

`pnpm test` で、副作用のない純粋なロジック (URL 変換 / エラーメッセージ変換 / 設定値の検証 /
通知文面 / 表示テキスト) の単体テストを実行します。UI や AWS の API に依存する部分は、実機
(`pnpm dev` と sandbox) での確認を前提としています。

## 運用手順とトラブルシューティング

利用者の追加、パスワードのリセット、認証アプリを紛失した場合の対応、ログの確認方法、本番移行の
チェックリストなどは [docs/operations.md](docs/operations.md) にまとめています。

## 実装上の注意点

AWS の仕様には、コード上は正しく見えても、デプロイや実機で動かして初めて分かる注意点が
いくつかあります。主なものはコード内のコメントに理由まで書いてあります。設定を変更する前に、
対象ファイルの先頭コメントとインラインコメントに目を通してください。
