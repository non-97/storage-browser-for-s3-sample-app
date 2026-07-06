import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import { auth } from "./auth/resource";
import { storage } from "./storage/resource";
import { hardenUserPool } from "./auth/user-pool-hardening";
import { attachThreatProtection } from "./auth/threat-protection";
import { enableManagedLogin } from "./auth/managed-login";
import { hardenSharedFilesBucket } from "./storage/bucket-hardening";
import { createAuditTrail } from "./monitoring/audit-trail";
import { attachCognitoWaf } from "./monitoring/cognito-waf";
import { exportCognitoActivityLog } from "./monitoring/cognito-activity-log";
import { CognitoCustomDomain } from "./custom/cognito-custom-domain";
import { customDomainConfig } from "./app.config";

// このファイルはバックエンド全体の「配線 (オーケストレーション)」だけを行う。
// 各機能の具体的な設定は amplify/auth・storage・monitoring 配下のモジュールにある。
// リソースの追加設定は基本的に対応するモジュールを編集する。
//
// 可変設定の入口: amplify/app.config.ts
//   (カスタムドメイン / 証明書 / ホストゾーン / ライフサイクル日数 / WAF レート制限 / SES ID)

const backend = defineBackend({
  auth,
  storage,
});

const { userPool, userPoolClient } = backend.auth.resources;
const { cfnUserPool, cfnUserPoolClient, cfnIdentityPool } =
  backend.auth.resources.cfnResources;

// sandbox (ローカル開発) かブランチデプロイ (Amplify Hosting) かを判定する。
// Amplify が synth 時に設定する CDK コンテキスト amplify-backend-type を読む
// (値: "sandbox" | "branch" | "standalone")。本番専用リソース (カスタムドメイン /
// WAF / 監視ログ) はグローバル一意なドメインや固定名ロググループを使うため、sandbox を
// 本番と並行して動かすと衝突する。そこで sandbox では作らず、Amplify 生成の Cognito
// ドメイン + localhost で動かす。"sandbox" のときだけスキップし、branch /
// standalone では作る (二値判定にして standalone を取りこぼさない)。
const isSandbox =
  backend.stack.node.tryGetContext("amplify-backend-type") === "sandbox";

// --- 認証 (Cognito) の堅牢化 ---
hardenUserPool({ cfnUserPool, cfnUserPoolClient, cfnIdentityPool });
attachThreatProtection(userPool.stack, { cfnUserPool });
enableManagedLogin({ userPool, userPoolClient });

// Cognito Managed Login をカスタムドメインで公開する。本番専用 (sandbox ではスキップ)。
// カスタムドメインはグローバル一意でプールと 1:1 のため、sandbox で作ると本番と衝突する。
// sandbox ではカスタムドメインもパスキー RP ID も設定せず、Amplify 生成の Cognito ドメインを
// 使う (フロントは custom.customAuthDomain が無ければ生成ドメインにフォールバックする)。
if (!isSandbox) {
  // 設定値は App レベル (app.config.ts) から注入する。
  // この Construct 内でパスキーの RP ID もカスタムドメインに設定される。
  const publicHostedZone = HostedZone.fromHostedZoneAttributes(
    userPool.stack,
    "PublicZone",
    {
      hostedZoneId: customDomainConfig.hostedZoneId,
      zoneName: customDomainConfig.hostedZoneName,
    },
  );

  // ACM 証明書の ARN は、config の証明書 ID / リージョンとデプロイ先アカウントから
  // 組み立てる。アカウント ID をコードにハードコードしないため Stack.of().account を使う。
  const certificateArn = `arn:aws:acm:${customDomainConfig.certificateRegion}:${Stack.of(userPool.stack).account}:certificate/${customDomainConfig.certificateId}`;

  new CognitoCustomDomain(userPool.stack, "CognitoCustomDomain", {
    cfnUserPool,
    domainName: customDomainConfig.domainName,
    relyingPartyId: customDomainConfig.webAuthnRelyingPartyId,
    certificateArn,
    hostedZone: publicHostedZone,
  });

  // フロントエンドへはカスタム認証ドメイン名のみを amplify_outputs.json 経由で渡す。
  // ARN やホストゾーン ID などのインフラ識別子をクライアントバンドルに載せないため、
  // フロントから app.config.ts を直接 import しないこと。
  backend.addOutput({
    custom: {
      customAuthDomain: customDomainConfig.domainName,
    },
  });
} else {
  // sandbox はカスタムドメインを作らないため RP ID をここで設定する。
  // hardenUserPool が WEB_AUTHN を第一要素に許可しており、RP ID 未設定だと
  // デプロイが失敗し得るのを避ける。localhost は WebAuthn のセキュアコンテキスト
  // 例外で、RP ID "localhost" は http://localhost:5173 と一致するため、sandbox でも
  // パスキーの登録・検証ができる。
  cfnUserPool.webAuthnRelyingPartyId = "localhost";
}

// ============================================================
// セキュリティ強化リソース
// ============================================================
// スタック分割の理由(循環参照回避):
//   storage → security (KMS キー参照)
//   auth → security (ロールへの KMS 権限付与)
//   monitoring → storage, auth (CloudTrail / WAF の参照)
// この向きなら循環しない。security に他スタックへの参照を持たせないこと

// --- security スタック: S3 バケットの堅牢化 (KMS / CORS / ライフサイクル) ---
const securityStack = backend.createStack("security");
hardenSharedFilesBucket(securityStack, {
  cfnBucket: backend.storage.resources.cfnResources.cfnBucket,
  authenticatedRole: backend.auth.resources.authenticatedUserIamRole,
  groupRoles: Object.values(backend.auth.resources.groups).map(
    (group) => group.role,
  ),
});

// sandbox は使い捨て。config が deletionProtection: true でも、sandbox では User Pool の
// 削除保護を外して ampx sandbox delete でクリーンに消せるようにする。データバケットは
// defineStorage の keepOnDelete を Amplify が sandbox で自動的に無視する (常に DESTROY) ため、
// ここでの上書きは不要。
if (isSandbox) {
  cfnUserPool.deletionProtection = "INACTIVE";
}

// --- monitoring スタック: CloudTrail + WAF + ログ (本番専用。sandbox ではスキップ) ---
// WAF ログと脅威保護ログのロググループは固定名で、sandbox が本番と衝突する。
// CloudTrail 監査ログもローカルの機能確認には不要なため、まとめて sandbox では作らない。
if (!isSandbox) {
  const monitoringStack = backend.createStack("monitoring");
  createAuditTrail(monitoringStack, {
    targetBucket: backend.storage.resources.bucket,
  });
  attachCognitoWaf(monitoringStack, {
    userPoolArn: backend.auth.resources.userPool.userPoolArn,
  });
  exportCognitoActivityLog(monitoringStack, {
    userPoolId: cfnUserPool.ref,
  });
}
