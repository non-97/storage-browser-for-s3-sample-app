import { Stack } from "aws-cdk-lib";
import { CfnUserPoolRiskConfigurationAttachment } from "aws-cdk-lib/aws-cognito";
import type { CfnUserPool } from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";
import { securityConfig } from "../app.config";

/**
 * 脅威保護のリスク通知メール本文を組み立てる純粋関数。
 * Cognito が置換するプレースホルダー ({username} 等) を含む日本語テンプレート。
 * 副作用が無いので単体テストの対象。
 */
export function buildRiskNotifyEmailBody(
  heading: string,
  guidance: string,
): string {
  return (
    `${heading}\n\n` +
    `対象アカウント: {username}\n` +
    `日時: {login-time}\n` +
    `IP アドレス: {ip-address}\n` +
    `場所: {city}, {country}\n\n` +
    `${guidance}\n\n` +
    `心当たりがない場合は、直ちにパスワードを変更し、システム管理者へ連絡してください。`
  );
}

/**
 * 脅威保護のリスクアクションと通知メールを設定する。
 * 漏洩認証情報: ブロック / アカウント乗っ取り: 高=ブロック、中=MFA 要求。
 * 高・中リスクの応答時は本人へ通知メールを送る (notify: true)。
 * 送信元 SES ID は app.config.ts で指定 (東京プールで使えるのは
 * 東京 / us-east-1 / us-west-2 / eu-west-1 の検証済み ID)。
 *
 * @param scope リソースを作成するスコープ (userPool.stack を渡す)
 */
export function attachThreatProtection(
  scope: Construct,
  props: { cfnUserPool: CfnUserPool },
): void {
  const { cfnUserPool } = props;

  new CfnUserPoolRiskConfigurationAttachment(scope, "RiskConfiguration", {
    userPoolId: cfnUserPool.ref,
    clientId: "ALL",
    compromisedCredentialsRiskConfiguration: {
      actions: { eventAction: "BLOCK" },
    },
    accountTakeoverRiskConfiguration: {
      notifyConfiguration: {
        // sourceArn は「検証済み SES ID」(ドメイン or アドレス) から組み立てる。
        // アカウント ID はハードコードせず Stack.of().account で導出する。
        // from は sourceArn の identity 配下の送信元アドレス。
        sourceArn: `arn:aws:ses:${securityConfig.sesIdentityRegion}:${Stack.of(scope).account}:identity/${securityConfig.sesIdentity}`,
        from: securityConfig.sesFromAddress,
        blockEmail: {
          subject: "【共有ファイル管理】不審なサインインをブロックしました",
          textBody: buildRiskNotifyEmailBody(
            "あなたのアカウントで不審なサインインを検知し、ブロックしました。",
            "このサインインはブロックされたため、アクセスは行われていません。",
          ),
        },
        mfaEmail: {
          subject: "【共有ファイル管理】追加の本人確認が要求されました",
          textBody: buildRiskNotifyEmailBody(
            "あなたのアカウントで通常と異なるサインインを検知したため、追加の本人確認 (MFA) を要求しました。",
            "本人による操作であれば、MFA を完了してサインインを続行してください。",
          ),
        },
      },
      actions: {
        highAction: { eventAction: "BLOCK", notify: true },
        mediumAction: { eventAction: "MFA_IF_CONFIGURED", notify: true },
        lowAction: { eventAction: "NO_ACTION", notify: false },
      },
    },
  });
}
