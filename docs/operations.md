# 運用ガイド (共有ファイル管理)

日々の運用作業の手順集です。多くの作業は、AWS CLI を使って東京リージョン (ap-northeast-1) の
Cognito User Pool を操作します。パスワードなどの機密情報は、このファイルには書かないでください。

ここでの「利用者」はシステムにサインインしてファイルを扱う職員を、「管理者」は下記のコマンドを
実行する運用担当者を指します。

## 事前準備: User Pool ID などの調べ方

多くのコマンドで User Pool ID が必要です。値はプロジェクトルートの `amplify_outputs.json` に
入っています。このファイルは `pnpm sandbox` を一度実行すると生成されます。clone した直後には
存在しないため、先に一度デプロイしておいてください。

```bash
# User Pool ID
node -e "console.log(require('./amplify_outputs.json').auth.user_pool_id)"
# 認証ドメイン
node -e "console.log(require('./amplify_outputs.json').custom.customAuthDomain)"
```

以下の手順では `<POOL_ID>` を実際の値に置き換えてください。リージョンは常に `ap-northeast-1` です。

> パスワードをコマンドの引数で渡すと、シェルの履歴に平文で残ります。作業後は
> `history -d <番号>` などで該当行を消してください。

---

## 1. 利用者の追加

セルフサインアップは無効にしてあります。管理者が次の 3 ステップ (作成 → パスワード設定 →
グループ割り当て) で作成します。

```bash
# (1) 利用者を作成する。ウェルカムメールは送らない
aws cognito-idp admin-create-user \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --user-attributes Name=email,Value=user@example.jp Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --region ap-northeast-1

# (2) 初期パスワードを設定する。--permanent を付けると変更不要、付けないと初回サインイン時に変更を強制
#     パスワードは 16 文字以上で、大文字 / 小文字 / 数字 / 記号を含めること
aws cognito-idp admin-set-user-password \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --password 'ここに初期パスワード' \
  --permanent \
  --region ap-northeast-1

# (3) グループに割り当てる。admin / dept-a / dept-b のいずれか。不要なら省略
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <POOL_ID> \
  --username user@example.jp \
  --group-name dept-a \
  --region ap-northeast-1
```

- 初回サインイン時に、認証アプリ (TOTP による MFA) のセットアップが求められます
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
# 管理者が新しいパスワードを直接設定する (--permanent)
aws cognito-idp admin-set-user-password --user-pool-id <POOL_ID> --username user@example.jp --password '新しいパスワード' --permanent --region ap-northeast-1
```

- `--permanent` を外すと、初回サインイン時に本人が変更する仮パスワードになります
- 利用者自身は、サインイン後に画面右上の「アカウント設定 > パスワードの変更」から変更できます。
  変更すると、そのアカウントの全端末からサインアウトされます

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
- 登録は Managed Login の専用画面へ遷移して行います。顔認証 / 指紋 / PIN などが使えます
- 認証アプリ (TOTP) は 1 人 1 つだけですが、パスキーは端末ごとに複数登録できます

## 6. 設定値の変更 (ライフサイクル日数 / WAF レート / 通知元)

`amplify/app.config.ts` を書き換えて保存するだけです。watch モードの sandbox が
自動でデプロイします。

- Standard-IA への移行日数は、30 日以上でないと synth の段階でエラーになります
- 監査ログの失効日数は、IA 移行日数より大きくする必要があります
- 通知元の SES ID を変える場合は、その ID に対して Cognito からの送信を許可する SES の
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

本番公開の前に必ず対応します。詳細は `tasks/todo.md` にも記載しています。

- [ ] `amplify/auth/resource.ts` の callbackUrls / logoutUrls から `http://localhost:5173` を
      **削除**し、本番 URL (https) に**置換**する。追加ではなく置換すること
- [ ] `amplify/storage/bucket-hardening.ts` の CORS の `allowedOrigins` を本番オリジンだけにする
- [ ] User Pool の削除保護 (DeletionProtection) を有効にする
- [ ] sandbox 由来のバケット自動削除 (autoDeleteObjects) を無効にする
- [ ] Amplify Hosting にセキュリティヘッダーを設定する。CSP (読み込み元の制限) / HSTS (HTTPS 強制) / Referrer-Policy: no-referrer (参照元の非送信)
- [ ] `amplify.yml` にバックエンドのデプロイフェーズを追加する
- [ ] 脅威保護通知の送信元を、個人アドレスから専用の no-reply ドメインに変える
- [ ] SES がサンドボックス状態なら、本番アクセスを申請する

## 10. トラブルシューティング

| 症状 | 考えられる原因と対処 |
|---|---|
| ログイン画面が出ない / エラーになる | カスタムドメインの反映待ち (最大 1 時間) / `amplify_outputs.json` が古い。sandbox を再デプロイして更新する |
| 認証アプリの登録で「入力が無効です」と出る | WAF がブロックしている可能性。`amplify/monitoring/cognito-waf.ts` の TOTP 除外設定を確認し、WAF ログでブロック元を調べる |
| デプロイが UPDATE_ROLLBACK になる | CloudFormation コンソールでスタックイベントの失敗理由を確認する。多くは設定値やリソース依存の問題 |
| 設定変更が反映されない | watch モードの sandbox (`AWS_REGION=ap-northeast-1 pnpm sandbox`) が起動しているか確認する |
| 画面が真っ白になる | ブラウザのコンソールでエラーを確認する。`amplify_outputs.json` の欠落が典型的 |
