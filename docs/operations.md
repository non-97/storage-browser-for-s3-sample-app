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
作成します。仮パスワードは招待メールで本人へ直接届くため、管理者が平文パスワードを手順書や
チャットに残す必要はありません。

このプールはパスキー (WEB_AUTHN) を第一要素に許可しているため、Cognito 側でパスワードレスと
みなされ、仮パスワードの自動生成が行われません。そのため作成時は `--temporary-password` で
仮パスワードを明示的に渡す必要があります。下記のように、その場で生成して変数経由で渡し、
値は画面に出さずに作業します。

```bash
# (1) 利用者を作成する。仮パスワードはその場で生成して渡し、招待メールで本人へ届く。
#     --desired-delivery-mediums EMAIL は必須 (省略するとデフォルトの SMS 配信になり届かない)

# 仮パスワードをその場で生成する (値は表示しない)。
# ポリシー: 16 文字以上 / 大文字 / 小文字 / 数字 / 記号。末尾の Aa1- で各種を確実に満たす。
TMP_PW="$(openssl rand -base64 18)Aa1-"

aws cognito-idp admin-create-user \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --user-attributes Name=email,Value=user@example.jp Name=email_verified,Value=true \
  --temporary-password "$TMP_PW" \
  --desired-delivery-mediums EMAIL \
  --region ap-northeast-1

unset TMP_PW

# (2) グループに割り当てる。admin / dept-a / dept-b のいずれか。不要なら省略
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --group-name dept-a \
  --region ap-northeast-1
```

- `$TMP_PW` の値は読む必要がありません。本人には招待メールで届きます。`echo $TMP_PW` はせず、
  作成後に `unset` で変数を消してください
- 本人が招待メールの仮パスワードでサインインすると、新しいパスワードの設定を求められ、
  続けて認証アプリ (TOTP による MFA) のセットアップが求められます
- 仮パスワードの有効期限は 3 日です。期限が切れた場合は、新しい仮パスワードを生成して再招待します。
  有効期限もリセットされます

  ```bash
  TMP_PW="$(openssl rand -base64 18)Aa1-"

  aws cognito-idp admin-create-user \
    --user-pool-id <POOL_ID> \
    --username user@example.jp \
    --message-action RESEND \
    --temporary-password "$TMP_PW" \
    --desired-delivery-mediums EMAIL \
    --region ap-northeast-1

  unset TMP_PW
  ```

- グループはアクセスできるフォルダに対応します。
  - admin: すべてのフォルダ
  - dept-a: shared フォルダと dept-a フォルダ
  - dept-b: shared フォルダと dept-b フォルダ

## 2. 利用者の削除とグループ変更

```bash
# グループから外す
aws cognito-idp admin-remove-user-from-group \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --group-name dept-a \
  --region ap-northeast-1

# 利用者を削除する。S3 上のファイルは削除されない
aws cognito-idp admin-delete-user \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --region ap-northeast-1
```

## 3. パスワードのリセット

パスワードを忘れた利用者は、**自分で再設定できます。管理者の操作は不要です**。

- サインイン画面で「パスワードをお忘れですか?」を押します
- 検証済みメールに確認コードが届くので、そのコードと新しいパスワードを入力して再設定します
- サインイン済みの場合は「アカウント設定 > パスワードの変更」からも変更できます。変更すると、
  そのアカウントの全端末からサインアウトされます

注意点:

- 確認コードは、サインイン画面の**「パスワード」欄に入れるものではありません**。「パスワードを
  お忘れですか?」から進んだ先の、コード入力欄に入れます。パスワード欄に入れると「入力が無効です」
  になります
- リセットの完了に MFA は要求されず、メールの確認コードと新しいパスワードのみで完了します。
  ただしサインインには TOTP かパスキーが必須のため、メールが侵害されただけではアカウントは
  奪われません

## 4. 認証アプリ (MFA) を紛失した利用者への対応

**重要**: Cognito は登録済みの認証アプリ (TOTP) を、管理者側でリセット / 削除できません。これは
公式仕様で、`admin-set-user-mfa-preference` で無効化しても TOTP シークレット本体は残り、サインイン
時に引き続きコードを要求されます (実機確認済み)。したがって対応は本人のサインイン可否で分かれます。

- **本人がまだサインインできる場合**: パスキーを登録しているか、現行の認証アプリがまだ使えるなら、
  「アカウント設定 > 認証アプリ (TOTP) の変更・移行」で本人が新しい認証アプリに付け替えられます。
  管理者操作は不要です
- **完全にサインインできない場合** (認証アプリもパスキーも失った): 管理者が TOTP をリセットする
  手段はありません。利用者を削除して作り直してください。S3 上のファイルは失われません

  ```bash
  aws cognito-idp admin-delete-user \
    --user-pool-id <POOL_ID> \
    --username user@example.jp \
    --region ap-northeast-1
  ```

  削除後、§1 の手順で作り直し、必要ならグループを割り当て直します。

**予防策**: TOTP は紛失時にリセットできないため、利用者にはパスキーを 1 つ登録しておくよう勧めて
ください。パスキーがあれば、認証アプリを失ってもパスキーでサインインして自分で付け替えられ、
削除 / 再作成を避けられます (パスキーの登録は §5)。

## 5. パスキーの管理

- 利用者自身が「アカウント設定 > パスキー」で登録 / 一覧 / 削除ができます。1 人あたり最大 20 個まで登録できます
- 登録はこの設定画面上で完結します。別画面への遷移はなく、ボタンを押すとブラウザが顔認証 / 指紋 / PIN の入力を求めます
- 認証アプリ (TOTP) は 1 人 1 つだけですが、パスキーは端末ごとに複数登録できます
- パスキー単体でサインインでき、そのサインインは MFA を満たした扱いになります。TOTP の入力は不要です

## 6. 誤って削除 / 上書きしたファイルの復元

バケットはバージョニングが有効なため、削除 / 上書きから **30 日以内** (非現行バージョンの
保持日数。`amplify/app.config.ts` の `dataNoncurrentVersionExpirationDays`) であれば復元
できます。30 日を過ぎると旧バージョンは自動で失効し、復元できません。気付いたらすぐ着手して
ください。復元は利用者ではなく、管理者が AWS CLI で行います。

バケット名は次で確認できます。

```bash
node -e "console.log(require('./amplify_outputs.json').storage.bucket_name)"
```

### 削除したファイルを戻す (削除マーカーの除去)

バージョニングでは、削除は「削除マーカー」の追加として記録されます。マーカーを消すと、
直前のバージョンがそのまま復活します。

```bash
# (1) 対象キーのバージョン一覧を確認し、DeleteMarkers の VersionId を控える
aws s3api list-object-versions \
  --bucket <BUCKET> \
  --prefix "shared/example.xlsx" \
  --region ap-northeast-1

# (2) 削除マーカーを削除する (--version-id は DeleteMarkers 側の VersionId)
aws s3api delete-object \
  --bucket <BUCKET> \
  --key "shared/example.xlsx" \
  --version-id <DELETE_MARKER_VERSION_ID> \
  --region ap-northeast-1
```

### 上書きしたファイルを元に戻す (旧バージョンの引き上げ)

```bash
# (1) バージョン一覧から戻したいバージョンの VersionId を控える (LastModified で判断)
aws s3api list-object-versions \
  --bucket <BUCKET> \
  --prefix "shared/example.xlsx" \
  --region ap-northeast-1

# (2) 旧バージョンをローカルへ取得する (最後の restored.xlsx は保存先ファイル名)
aws s3api get-object \
  --bucket <BUCKET> \
  --key "shared/example.xlsx" \
  --version-id <VERSION_ID> \
  --region ap-northeast-1 \
  restored.xlsx

# (3) 同じキーへアップロードし直す (これが新しい現行バージョンになる)
aws s3 cp restored.xlsx "s3://<BUCKET>/shared/example.xlsx" \
  --region ap-northeast-1
```

- 暗号化 (SSE-KMS) はバケットのデフォルト設定が自動で適用されるため、指定は不要です
- 復元し終えたら、ローカルに取得したファイル (restored.xlsx) は削除してください

## 7. 設定値の変更 (削除保護 / ライフサイクル日数 / WAF レート / 通知元)

`amplify/app.config.ts` を書き換えてコミットし、リポジトリに git push します。Amplify Hosting が
Webhook で変更を検知し、バックエンド (`ampx pipeline-deploy`) とフロントエンドを自動でビルド /
デプロイします。デプロイの詳細は下記「10. Amplify Hosting のデプロイと運用」を参照してください。

- `deletionProtection` を `true` にすると、User Pool は削除保護 ACTIVE、S3 バケットは
  RemovalPolicy.RETAIN になります。使い捨ての検証環境では `false` にします
- Standard-IA への移行日数は、30 日以上でないと synth の段階でエラーになります
- 監査ログの失効日数は、IA 移行日数より大きくする必要があります
- 通知元 / 送信元の SES ID を変える場合は、その ID に対して Cognito からの送信を許可する SES の
  ポリシーを付け替える必要があります。詳しくはファイル内のコメントを参照してください

## 8. ログイン画面のロゴ変更

- `amplify/assets/login-logo.png` を差し替えて保存します
- 画像の縦横比は 1:1〜4:1 の範囲にしてください。範囲外だとデプロイ時に 400 エラーになります
- SVG ではなく PNG を使ってください。Cognito 側で SVG の一部が加工されて日本語が崩れることが
  あるためです

## 9. ログの確認方法

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

## 10. Amplify Hosting のデプロイと運用

- デプロイはリポジトリへの `git push` で始まります。Amplify Hosting が Webhook でブランチの変更を
  検知し、`amplify.yml` の backend フェーズ (`ampx pipeline-deploy`) と frontend フェーズ
  (`pnpm run build`) を順に実行します
- 手動で再ビルドするには次を実行します。`<APP_ID>` は対象環境の Amplify アプリ ID で、
  次の list-apps で確認できます

  ```bash
  # アプリ ID の確認
  aws amplify list-apps \
    --region ap-northeast-1 \
    --query "apps[].{appId:appId,name:name}" \
    --output table

  # 再ビルド
  aws amplify start-job \
    --app-id <APP_ID> \
    --branch-name main \
    --job-type RELEASE \
    --region ap-northeast-1
  ```

- カスタムドメインの設定は `scripts/setup-custom-domain.sh` で行います。冪等なので何度実行しても
  同じ状態に収束します。環境固有値は環境変数で渡します

  ```bash
  APP_ID=<APP_ID> \
  DOMAIN_NAME=<フロントのFQDN> \
  HOSTED_ZONE_ID=<Route53ホストゾーンID> \
  ./scripts/setup-custom-domain.sh
  ```
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
