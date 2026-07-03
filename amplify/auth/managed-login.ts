import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CfnResource } from "aws-cdk-lib";
import { CfnManagedLoginBranding } from "aws-cdk-lib/aws-cognito";
import type { IUserPool, IUserPoolClient } from "aws-cdk-lib/aws-cognito";
import brandingSettings from "../assets/branding-settings.json";

// フォームロゴ PNG を synth 時に読み込み base64 化する。
// CFN の ManagedLoginBranding.Assets[].Bytes は base64 必須のため。
// PNG を単一の出所とし、base64 のコミット済みコピーは持たない。
const loginLogoPngBase64 = readFileSync(
  fileURLToPath(new URL("../assets/login-logo.png", import.meta.url)),
).toString("base64");

/**
 * Managed Login (新しいホスト型ログイン UI, v2) を有効化し、ブランディング
 * (共有ファイル管理 / Storage Browser for S3 のフォームロゴ) を設定する。
 *
 * Amplify が externalProviders 用に自動生成した UserPoolDomain を探し出し、
 * ManagedLoginVersion=2 を上書きしたうえでブランディングを紐付ける。
 */
export function enableManagedLogin(props: {
  userPool: IUserPool;
  userPoolClient: IUserPoolClient;
}): void {
  const { userPool, userPoolClient } = props;

  // Amplify が externalProviders 用に自動生成した L1 UserPoolDomain を取得
  // pnpm のモジュール解決で instanceof が失敗するため cfnResourceType で判定する(ダックタイピング)
  const domainCandidates = userPool.node
    .findAll()
    .filter(
      (c): c is CfnResource =>
        (c as CfnResource).cfnResourceType === "AWS::Cognito::UserPoolDomain",
    );

  if (domainCandidates.length === 0) {
    throw new Error(
      "UserPoolDomain が見つかりません。defineAuth に externalProviders + domainPrefix を設定してください。",
    );
  }
  if (domainCandidates.length > 1) {
    throw new Error(
      `UserPoolDomain が ${domainCandidates.length} 件見つかりました。想定は1件です。`,
    );
  }
  const cfnUserPoolDomain = domainCandidates[0];

  // Managed Login (新ブランディング UI) を有効化 (1=Hosted UI classic / 2=Managed login)
  cfnUserPoolDomain.addPropertyOverride("ManagedLoginVersion", 2);

  // Managed Login のブランディング。
  // Cognito 既定スタイル (branding-settings.json = describe の ReturnMergedResources 出力を
  // 土台に form.logo.enabled=true へ変更) に、フォームロゴ (共有ファイル管理 / Storage Browser
  // for S3 バナー PNG) を FORM_LOGO アセットとして登録する。
  // useCognitoProvidedValues と settings/assets は併用不可のため useCognitoProvidedValues は指定しない。
  // PNG を使うのは Cognito の SVG サニタイザが role/aria-label を許可せず日本語 <text> 描画も
  // 保証されないため (PNG が最も予測可能)。
  const branding = new CfnManagedLoginBranding(
    userPool.stack,
    "ManagedLoginBranding",
    {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      settings: brandingSettings,
      assets: [
        {
          category: "FORM_LOGO",
          colorMode: "LIGHT",
          extension: "PNG",
          bytes: loginLogoPngBase64,
        },
      ],
    },
  );

  // 作成順序を明示 (Domain → Branding)
  branding.node.addDependency(cfnUserPoolDomain);
}
