# 運用ガイド (共有ファイル管理)

日々の運用作業の手順集です。多くの作業は、AWS CLI を使って東京リージョン (ap-northeast-1) の
Cognito User Pool を操作します。パスワードなどの機密情報は、このファイルには書かないでください。

ここでの「利用者」はシステムにサインインしてファイルを扱う職員を、「管理者」は下記のコマンドを
実行する運用担当者を指します。

## 事前準備: User Pool ID などの調べ方

多くのコマンドで User Pool ID が必要です。値はプロジェクトルートの `amplify_outputs.json` に
入っています。このファイルは Amplify Hosting のバックエンドビルド時に生成されます。ローカル開発では
`pnpm sandbox` でも生成できます。本番プールの ID は Amplify コンソールのデプロイ出力からも確認できます。

```bash
# User Pool ID
node -e "console.log(require('./amplify_outputs.json').auth.user_pool_id)"
# 認証ドメイン
node -e "console.log(require('./amplify_outputs.json').custom.customAuthDomain)"
```

以下の手順では `<POOL_ID>` を実際の値に置き換えてください。リージョンは常に `ap-northeast-1` です。

> **sandbox と本番は別プールです。** `pnpm sandbox` で動かすローカルの sandbox は、本番とは
> 独立した User Pool を持ちます。`amplify_outputs.json` は最後に生成した環境のものになるため、
> ローカルで sandbox を動かした後はその値が sandbox プールを指します。利用者 / パスキー / TOTP は
> プールごとに独立するので、sandbox で認証を試すときは、sandbox プールの ID に対して下記の §1 の
> 手順で利用者を作り直してください。

> 本ガイドの手順には、パスワードをコマンドに直接書くものはありません (仮パスワードは
> Cognito が生成して本人へメール送付します)。例外的に `admin-set-user-password` などで
> パスワードを引数に渡す場合は、シェルの履歴に平文で残るため、作業後に
> `history -d <番号>` などで該当行を消してください。

---

## 1. 利用者の追加

セルフサインアップは無効にしてあります。管理者が次の 2 ステップ (作成 → グループ割り当て) で
作成します。仮パスワードは Cognito が自動生成して招待メールで本人へ直接送るため、管理者が
パスワードを扱うことはありません。

```bash
# (1) 利用者を作成する。Cognito が仮パスワードを生成し、招待メールを本人へ送る。
#     --desired-delivery-mediums EMAIL は必須 (省略するとデフォルトの SMS 配信になり届かない)
aws cognito-idp admin-create-user \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --user-attributes Name=email,Value=user@example.jp Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region ap-northeast-1

# (2) グループに割り当てる。admin / dept-a / dept-b のいずれか。不要なら省略
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --group-name dept-a \
  --region ap-northeast-1
```

- 本人が招待メールの仮パスワードでサインインすると、新しいパスワードの設定を求められ、
  続けて認証アプリ (TOTP による MFA) のセットアップが求められます
- 仮パスワードの有効期限は 3 日です。期限が切れた場合は、次のコマンドで再招待します。
  新しい仮パスワードが生成され、有効期限もリセットされます

  ```bash
  aws cognito-idp admin-create-user \
    --user-pool-id <POOL_ID> \
    --username user@example.jp \
    --message-action RESEND \
    --desired-delivery-mediums EMAIL \
    --region ap-northeast-1
  ```

- グループはアクセスできるフォルダに対応します。
  - admin: すべてのフォルダ
  - dept-a: shared フォルダと dept-a フォルダ
  - dept-b: shared フォルダと dept-b フォルダ

## 2. 利用者の削除とグループ変更

```bash
# グループから外す
aws cognito-idp admin-remove-user-from-group --user-pool-id <POOL_ID> --username user@example.jp --group-name dept-a --region ap-northeast-1

# 利用者を削除する。S3 上のファイルは削除されない
aws cognito-idp admin-delete-user --user-pool-id <POOL_ID> --username user@example.jp --region ap-northeast-1
```

## 3. パスワードのリセット

```bash
# リセットを強制する。確認コードが本人の検証済みメールに届く
aws cognito-idp admin-reset-user-password \
  --user-pool-id <POOL_ID> --username user@example.jp --region ap-northeast-1
```

- 実行後、本人が次にサインインしようとすると、メールに届いた確認コードと新しいパスワードの
  入力を求められます。管理者が新しいパスワードを扱うことはありません
- 本人が自分で変えたい場合は、サインイン画面の「パスワードをお忘れですか」からも同じ流れで
  再設定できます。サインイン済みなら「アカウント設定 > パスワードの変更」も使えます。
  変更すると、そのアカウントの全端末からサインアウトされます
- 補足: リセットの完了に MFA は要求されず、メールの確認コードと新パスワードのみで完了します。
  ただしサインインには TOTP かパスキーが必須のため、メールが侵害されただけではアカウントは
  奪われません

## 4. 認証アプリ (MFA) を紛失した利用者への対応

- **本人がまだサインインできる場合**: 別のパスキーを登録しているなどでサインインできるなら、
  画面の「アカウント設定 > 認証アプリの再設定」で本人が新しい認証アプリを登録できます
- **まったくサインインできない場合**: 管理者が登録済みの認証アプリを無効化し、次回サインイン時に
  再登録させます。

  ```bash
  aws cognito-idp admin-set-user-mfa-preference \
    --user-pool-id <POOL_ID> --username user@example.jp \
    --software-token-mfa-settings Enabled=false,PreferredMfa=false \
    --region ap-northeast-1
  ```

  実行後、本人がパスワードでサインインすると、認証アプリの再設定を求められます。
  この手順は、プールの MFA 必須設定との組み合わせで挙動が変わり得ます。初回の運用前に、
  実機で動きを確認してから手順として確定してください。うまくいかない場合は、利用者を削除して
  作り直せば回避できます。S3 上のファイルは失われません。

## 5. パスキーの管理

- 利用者自身が「アカウント設定 > パスキー」で登録 / 一覧 / 削除ができます。1 人あたり最大 20 個まで登録できます
- 登録はこの設定画面上で完結します。別画面への遷移はなく、ボタンを押すとブラウザが顔認証 / 指紋 / PIN の入力を求めます
- 認証アプリ (TOTP) は 1 人 1 つだけですが、パスキーは端末ごとに複数登録できます
- パスキー単体でサインインでき、そのサインインは MFA を満たした扱いになります。TOTP の入力は不要です

## 6. 設定値の変更 (削除保護 / ライフサイクル日数 / WAF レート / 通知元)

`amplify/app.config.ts` を書き換えてコミットし、リポジトリに git push します。Amplify Hosting が
Webhook で変更を検知し、バックエンド (`ampx pipeline-deploy`) とフロントエンドを自動でビルド /
デプロイします。デプロイの詳細は下記「10. Amplify Hosting のデプロイと運用」を参照してください。

- `deletionProtection` を `true` にすると、User Pool は削除保護 ACTIVE、S3 バケットは
  RemovalPolicy.RETAIN になります。使い捨ての検証環境では `false` にします
- Standard-IA への移行日数は、30 日以上でないと synth の段階でエラーになります
- 監査ログの失効日数は、IA 移行日数より大きくする必要があります
- 通知元 / 送信元の SES ID を変える場合は、その ID に対して Cognito からの送信を許可する SES の
  ポリシーを付け替える必要があります。詳しくはファイル内のコメントを参照してください

## 7. ログイン画面のロゴ変更

- `amplify/assets/login-logo.png` を差し替えて保存します
- 画像の縦横比は 1:1〜4:1 の範囲にしてください。範囲外だとデプロイ時に 400 エラーになります
- SVG ではなく PNG を使ってください。Cognito 側で SVG の一部が加工されて日本語が崩れることが
  あるためです

## 8. ログの確認方法

CloudWatch Logs Insights (マネジメントコンソール) で検索します。フィールドインデックスを
設定してあるため、下記のフィールドでの絞り込みは高速です。

### Cognito アクティビティログ

ロググループ: `/aws/vendedlogs/cognito/storage-browser-user-activity`

```
# サインイン失敗の一覧
fields @timestamp, message.userName, message.ipAddress, message.city, message.eventResponse
| filter message.eventResponse = "Fail"
| sort @timestamp desc
| limit 50
```

```
# 漏洩した認証情報が検知されたイベント
fields @timestamp, message.userName, message.ipAddress
| filter message.compromisedCredentialDetected = "true"
| sort @timestamp desc
```

### WAF ログ

ロググループ: `aws-waf-logs-storage-browser-cognito`

```
# WAF にブロックされたリクエスト (どのルールでブロックされたか)
fields @timestamp, action, terminatingRuleId, httpRequest.clientIp, httpRequest.country, httpRequest.uri
| filter action = "BLOCK"
| sort @timestamp desc
| limit 50
```

正規の利用者がブロックされている場合は、`httpRequest.country` や `terminatingRuleId` を確認し、
必要なら `amplify/app.config.ts` の `wafRateLimitPer5Minutes` を調整します。

### S3 の操作履歴 (CloudTrail)

S3 のファイル操作 (Get / Put / Delete) は、CloudTrail のデータイベントとして記録されます。
CloudTrail コンソールの「イベント履歴」か、SSE-KMS で暗号化されたログバケットを参照します。

## 9. 本番移行チェックリスト

詳細は `tasks/todo.md` にも記載しています。

対応済み (コードに実装済み。デプロイ後に実機確認する):

- [x] `amplify.yml` にバックエンドのデプロイフェーズを追加した
- [x] 脅威保護通知の送信元を、個人アドレスから専用の no-reply ドメイン noreply@www.non-97.net にした
- [x] 通常のユーザー宛メール (招待 / パスワードリセット等) を SES 送信に切り替えた
- [x] `securityConfig.deletionProtection` で User Pool の削除保護と S3 バケットの RemovalPolicy を制御できるようにした。本番は `true`
- [x] Amplify Hosting にセキュリティヘッダー (CSP / HSTS / X-Frame-Options / Referrer-Policy 等) を設定した
- [x] SES の本番アクセスを取得した

残件 / 方針:

- [ ] デプロイ後、CSP が UI を壊していないか実機確認する。アップロード / ダウンロード / パスキー登録 / QR 表示 / ログインを一通り試し、ブラウザコンソールに CSP 違反が出たら `amplify.yml` の該当ディレクティブを足す
- [ ] ビルドインスタンスを `XLARGE_72GB` から縮小する。恒久対応は AWS サポートに起票して `STANDARD_8GB` へ戻す。下記「10. Amplify Hosting のデプロイと運用」を参照
- localhost (`http://localhost:5173`) は開発用オリジンとして callbackUrls / logoutUrls / CORS にあえて残しています。より厳格にするなら、`amplify/auth/resource.ts` と `amplify/storage/bucket-hardening.ts` から削除して本番オリジンだけにします
- autoDeleteObjects は使わない方針です。削除保護を外してスタックを破棄するときは、事前にバケットを空にします

## 10. Amplify Hosting のデプロイと運用

- デプロイはリポジトリへの `git push` で始まります。Amplify Hosting が Webhook でブランチの変更を
  検知し、`amplify.yml` の backend フェーズ (`ampx pipeline-deploy`) と frontend フェーズ
  (`pnpm run build`) を順に実行します
- 手動で再ビルドするには次を実行します

  ```bash
  aws amplify start-job --app-id dugv9lhpj4k9l --branch-name main --job-type RELEASE --region ap-northeast-1
  ```

- カスタムドメインの設定は `scripts/setup-custom-domain.sh` で行います。冪等なので何度実行しても
  同じ状態に収束します
- GitHub 連携は Amplify GitHub App をリポジトリにインストール済みです。一度きりの作業です
- ビルドインスタンスは `XLARGE_72GB` を使っています。Vite 8 (Rolldown) のビルドが仮想メモリを
  大きく確保し、Amplify の監視プロセスが `Build container ran out of memory` と誤検知して
  ビルドを止めるためです。実使用のピークは約 3.2GiB で、メモリが枯渇しているわけではありません。
  恒久的には AWS サポートに起票して `STANDARD_8GB` へ戻す余地があります。詳細は
  `tasks/amplify-build-oom-investigation.md` に記録しています

## 11. パスキー有効化に必要な設定

パスキー (WebAuthn) を実際に登録して使えるようにするには、次の 3 つがすべて揃っている必要が
あります。どれか 1 つでも欠けると、登録時にそれぞれ固有のエラーになります。

- **RP ID = フロントエンドのドメイン**: `app.config.ts` の `webAuthnRelyingPartyId` に SPA の
  ドメイン storage-browser.www.non-97.net を指定します。auth ドメインを指定すると SPA の
  子ドメイン扱いになり、SPA からの登録ができません
- **AllowedFirstAuthFactors に WEB_AUTHN**: `user-pool-hardening.ts` の `signInPolicy` で第一要素に
  `WEB_AUTHN` を許可します。無いと「WebAuthn not enabled for this pool」になります
- **App Client の ExplicitAuthFlows に ALLOW_USER_AUTH**: 選択ベース認証 (USER_AUTH) フローを
  有効にします。無いと「USER_AUTH flow is not enabled for the client」になります

`ALLOW_USER_AUTH` を有効にすると平文パスワードによるサインイン経路も許可されますが、MFA 必須
設定で守られています。パスキー単体でのサインインは MFA を満たした扱いになります。

## 12. トラブルシューティング

| 症状 | 考えられる原因と対処 |
|---|---|
| ログイン画面が出ない / エラーになる | カスタムドメインの反映待ち (最大 1 時間) / `amplify_outputs.json` が古い。git push で再デプロイするか `aws amplify start-job` で再ビルドする |
| 認証アプリの登録で「入力が無効です」と出る | WAF がブロックしている可能性。`amplify/monitoring/cognito-waf.ts` の TOTP 除外設定を確認し、WAF ログでブロック元を調べる |
| デプロイが UPDATE_ROLLBACK になる | CloudFormation コンソールでスタックイベントの失敗理由を確認する。多くは設定値やリソース依存の問題 |
| 設定変更が反映されない | git push 後に Amplify のビルドが成功しているか、Amplify コンソールのビルド履歴か `aws amplify list-jobs` で確認する |
| 画面が真っ白になる | ブラウザのコンソールでエラーを確認する。`amplify_outputs.json` の欠落や CSP 違反が典型的 |
