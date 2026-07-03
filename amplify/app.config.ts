/**
 * アプリの環境固有設定を集約したファイル (App レベルのパラメータ注入点)。
 *
 * ここには実際のドメイン名や証明書 ID などの環境固有値が入るため、
 * **このファイルは .gitignore 対象**。リポジトリにコミットされるのは
 * ダミー値を入れた app.config.example.ts の方。新しく clone した場合は
 * example をコピーして実値を埋める (README 参照)。
 *
 * **フロントエンドからは import しないこと** (インフラ識別子をクライアント
 * バンドルに載せないため)。フロントへ渡す値は backend.addOutput 経由にする。
 */

/** Cognito Managed Login のカスタムドメインまわりの設定。 */
export const customDomainConfig = {
  /** Managed Login のカスタムドメイン FQDN */
  domainName: "auth.storage-browser.www.non-97.net",
  /**
   * パスキー (WebAuthn) の RP ID。**フロント SPA のドメイン**を指定する。
   * WebAuthn の仕様上、RP ID はオリジンと同じか親ドメインである必要がある。
   * SPA (storage-browser…) から直接パスキー登録するにはこれが SPA オリジンと
   * 一致していなければならず、かつ auth ドメイン (auth.storage-browser…) の
   * 親でもあるためログインにも使える。auth ドメインを RP ID にすると SPA の
   * 子ドメインになり登録できないので注意。
   */
  webAuthnRelyingPartyId: "storage-browser.www.non-97.net",
  /**
   * ACM 証明書の ID (ARN の末尾部分)。完全な ARN はアカウント ID を含むため
   * ここには持たせず、backend.ts で Stack.of().account と合わせて組み立てる。
   */
  certificateId: "ce98c8e8-283c-4a46-8327-bacfe50040a0",
  /** ACM 証明書のリージョン。Cognito カスタムドメインは us-east-1 必須。 */
  certificateRegion: "us-east-1",
  /** レコードを作成する公開ホストゾーン */
  hostedZoneId: "Z0062708UVGI90E3DEGD",
  hostedZoneName: "www.non-97.net",
} as const;

/** セキュリティ関連の可変設定 (ライフサイクル日数 / WAF / 脅威保護通知)。 */
export const securityConfig = {
  /**
   * 脅威保護通知に使う SES 検証済み ID。通知の sourceArn になる。
   * ドメイン検証なら "www.non-97.net" のようにドメインを、アドレス検証なら
   * そのメールアドレスを指定する。この ID には Cognito (cognito-idp.amazonaws.com)
   * からの送信を許可する SES sending authorization policy が必要。
   */
  sesIdentity: "www.non-97.net",
  /**
   * 通知メールの From アドレス。sesIdentity がドメインの場合は、その配下の
   * アドレス (例: noreply@www.non-97.net) にする。
   */
  sesFromAddress: "noreply@www.non-97.net",
  /**
   * 上記 SES ID が存在するリージョン。Cognito と同じ東京でよい。
   * 東京プールで使えるのは 東京 / us-east-1 / us-west-2 / eu-west-1。
   */
  sesIdentityRegion: "ap-northeast-1",
  /** S3 バケットの CORS で許可するオリジン (開発 + 本番) */
  appOrigins: [
    "http://localhost:5173",
    "https://storage-browser.www.non-97.net",
  ],
  /** データバケット: PUT から Standard-IA へ移行する日数 (S3 の制約で最小 30) */
  dataIaTransitionDays: 90,
  /** データバケット: 非現行バージョン (削除・上書き前の旧版) の失効日数 */
  dataNoncurrentVersionExpirationDays: 30,
  /** データバケット: 未完了マルチパートアップロードの中止日数 */
  dataAbortIncompleteUploadDays: 2,
  /** 監査ログバケット: Standard-IA へ移行する日数 (最小 30) */
  auditIaTransitionDays: 90,
  /** 監査ログバケット: オブジェクト失効 (削除) 日数。IA 移行日数より大きいこと */
  auditExpirationDays: 400,
  /** WAF レート制限: 5 分間あたり同一 IP からのリクエスト上限 (WAF の下限は 10) */
  wafRateLimitPer5Minutes: 300,
} as const;

/**
 * セキュリティ設定の値が AWS の制約を満たすか検証する (synth 時に実行)。
 * 違反があれば例外を投げてデプロイ前に気付けるようにする。副作用なしでテスト可能。
 */
export function validateSecurityConfig(config: {
  dataIaTransitionDays: number;
  auditIaTransitionDays: number;
  auditExpirationDays: number;
  wafRateLimitPer5Minutes: number;
}): void {
  if (config.dataIaTransitionDays < 30 || config.auditIaTransitionDays < 30) {
    throw new Error(
      "Standard-IA への移行日数は 30 日以上にしてください (S3 の制約)",
    );
  }
  if (config.auditExpirationDays <= config.auditIaTransitionDays) {
    throw new Error("監査ログの失効日数は IA 移行日数より大きくしてください");
  }
  if (config.wafRateLimitPer5Minutes < 10) {
    throw new Error("WAF レート制限の上限は 10 以上にしてください");
  }
}

validateSecurityConfig(securityConfig);
