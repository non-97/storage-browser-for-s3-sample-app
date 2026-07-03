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

// --- 認証 (Cognito) の堅牢化 ---
hardenUserPool({ cfnUserPool, cfnUserPoolClient, cfnIdentityPool });
attachThreatProtection(userPool.stack, { cfnUserPool });
enableManagedLogin({ userPool, userPoolClient });

// Cognito Managed Login をカスタムドメインで公開する。
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

// --- monitoring スタック: CloudTrail + WAF + ログ ---
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
