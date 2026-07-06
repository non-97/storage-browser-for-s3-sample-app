import { Stack } from "aws-cdk-lib";
import type {
  CfnUserPool,
  CfnUserPoolClient,
  CfnIdentityPool,
} from "aws-cdk-lib/aws-cognito";
import { securityConfig } from "../app.config";

/**
 * Amplify が生成した Cognito User Pool / App Client / Identity Pool に対して、
 * セキュリティ設定 (プラン / 脅威保護 / パスワードポリシー / MFA・パスキー要素 /
 * トークン有効期限 / リフレッシュトークンローテーション等) を上書きで適用する。
 *
 * ここで設定するのは Amplify 生成リソースへのプロパティ上書きなので、
 * CloudFormation の論理 ID には影響しない。
 */
export function hardenUserPool(props: {
  cfnUserPool: CfnUserPool;
  cfnUserPoolClient: CfnUserPoolClient;
  cfnIdentityPool: CfnIdentityPool;
}): void {
  const { cfnUserPool, cfnUserPoolClient, cfnIdentityPool } = props;

  // Plus プランに変更(脅威保護に必要。Managed Login は Essentials 以上で利用可)
  cfnUserPool.userPoolTier = "PLUS";

  // 削除保護。config の deletionProtection に従う。ACTIVE 中は User Pool を
  // 削除・置換する変更が拒否される。プール置換が必要なときは config を false に
  // してデプロイしてから行う。
  cfnUserPool.deletionProtection = securityConfig.deletionProtection
    ? "ACTIVE"
    : "INACTIVE";

  // 脅威保護を有効化: 標準認証 + カスタム認証フローの両方を強制適用
  cfnUserPool.userPoolAddOns = {
    advancedSecurityMode: "ENFORCED",
    advancedSecurityAdditionalFlows: {
      customAuthMode: "ENFORCED",
    },
  };

  // パスワードポリシー: 最小16文字 + 複雑性維持、仮パスワード有効期限3日。
  // サインインポリシー: パスワードに加えパスキー (WEB_AUTHN) を第一要素として許可する。
  // これが無いと Cognito は「WebAuthn not enabled for this pool」となり、
  // パスキーの登録 (StartWebAuthnRegistration) 自体ができない。
  cfnUserPool.policies = {
    passwordPolicy: {
      minimumLength: 16,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSymbols: true,
      temporaryPasswordValidityDays: 3,
    },
    signInPolicy: {
      allowedFirstAuthFactors: ["PASSWORD", "WEB_AUTHN"],
    },
  };

  // パスキー (ユーザー検証あり) を MFA を満たす要素として有効化。
  // FactorConfiguration を MULTI_FACTOR_WITH_USER_VERIFICATION にすることで、
  // ユーザー検証付きパスキーでのサインインが「多要素を満たした」扱いになる
  // (MFA REQUIRED を単一パスキーで満たせる。パスワード経路は従来どおり TOTP を要求)。
  // RP ID (webAuthnRelyingPartyId) はフロント SPA のドメインを使うため、
  // custom/cognito-custom-domain.ts の Construct 内で設定する。
  cfnUserPool.webAuthnUserVerification = "required";
  cfnUserPool.webAuthnFactorConfiguration =
    "MULTI_FACTOR_WITH_USER_VERIFICATION";

  // 通常のユーザー宛メール (招待 / パスワードリセット / MFA 設定 / 確認コード) を
  // SES 経由で送信する。既定の Cognito 送信は no-reply@verificationemail.com かつ
  // 1 日 50 通固定で本番には使えない。脅威保護通知と同じ SES 検証済み ID を流用する。
  // SES ID には Cognito (cognito-idp.amazonaws.com) からの送信を許可する
  // sending authorization policy が必要 (脅威保護通知用に既に付与済みのもの)。
  cfnUserPool.emailConfiguration = {
    emailSendingAccount: "DEVELOPER",
    sourceArn: `arn:aws:ses:${securityConfig.sesIdentityRegion}:${Stack.of(cfnUserPool).account}:identity/${securityConfig.sesIdentity}`,
    from: securityConfig.sesFromAddress,
  };

  // セルフサインアップを無効化(管理者がユーザーを作成する運用)
  cfnUserPool.adminCreateUserConfig = {
    allowAdminCreateUserOnly: true,
  };

  // ゲストアクセスを無効化
  cfnIdentityPool.allowUnauthenticatedIdentities = false;

  // Identity Pool 側でもトークン失効を検証する (サインアウト済みトークンでの
  // AWS 認証情報取得を拒否)。EnableTokenRevocation とセットで有効化。
  // CfnIdentityPool の型に ServerSideTokenCheck プロパティが無いため
  // addPropertyOverride で設定する (プロバイダー配列の 0 番目)。
  cfnIdentityPool.addPropertyOverride(
    "CognitoIdentityProviders.0.ServerSideTokenCheck",
    true,
  );

  // トークン有効期限: アクセス/ID 60分、リフレッシュ 12時間(1営業日で再ログイン)
  cfnUserPoolClient.accessTokenValidity = 60;
  cfnUserPoolClient.idTokenValidity = 60;
  cfnUserPoolClient.refreshTokenValidity = 12;
  cfnUserPoolClient.tokenValidityUnits = {
    accessToken: "minutes",
    idToken: "minutes",
    refreshToken: "hours",
  };

  // リフレッシュトークンローテーション: リフレッシュのたびに新しいリフレッシュ
  // トークンを発行し旧トークンを無効化する。盗難トークンの再利用を検知・遮断する。
  // amplify-js は @aws-amplify/auth >= 6.14.0 で GetTokensFromRefreshToken に対応済み。
  // retryGracePeriodSeconds: クライアント側リトライ用に旧トークンを残す秒数 (0-60)。
  cfnUserPoolClient.refreshTokenRotation = {
    feature: "ENABLED",
    retryGracePeriodSeconds: 10,
  };
  // ローテーション有効時はレガシーの ALLOW_REFRESH_TOKEN_AUTH フローと共存できない
  // (CloudFormation エラーになる)。amplify-js は GetTokensFromRefreshToken を使うため
  // このフローは不要。
  // ALLOW_USER_AUTH は選択ベース認証 (USER_AUTH) フロー。これが無いと
  // パスキー登録/サインイン (StartWebAuthnRegistration 等) が
  // "USER_AUTH flow is not enabled for the client" で失敗するため必須。
  cfnUserPoolClient.explicitAuthFlows = [
    "ALLOW_CUSTOM_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_AUTH",
  ];
}
