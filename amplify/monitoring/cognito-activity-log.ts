import type { Stack } from "aws-cdk-lib";
import { CfnLogDeliveryConfiguration } from "aws-cdk-lib/aws-cognito";
import {
  FieldIndexPolicy,
  LogGroup,
  RetentionDays,
} from "aws-cdk-lib/aws-logs";
import { logGroupArnWithoutWildcard } from "../common/log-group-arn";

/**
 * 脅威保護のユーザーアクティビティログ (サインイン試行等) を CloudWatch Logs へ
 * エクスポートする。フィールドインデックス付きで Logs Insights 検索を高速化する。
 * userAuthEvents / INFO は Plus プラン限定。
 *
 * @param monitoringStack backend.createStack("monitoring") で作ったスタック
 * @param props.userPoolId 対象 User Pool の ID (cfnUserPool.ref を渡す)
 */
export function exportCognitoActivityLog(
  monitoringStack: Stack,
  props: { userPoolId: string },
): void {
  const { userPoolId } = props;

  // ロググループは KMS 暗号化不可、リソースポリシー対策で /aws/vendedlogs/ 始まりの名前にする。
  const cognitoActivityLogGroup = new LogGroup(
    monitoringStack,
    "CognitoUserActivityLogGroup",
    {
      logGroupName: "/aws/vendedlogs/cognito/storage-browser-user-activity",
      retention: RetentionDays.THREE_MONTHS,
      // フィールドインデックス (Logs Insights 検索の高速化)。
      // イベントは message オブジェクトにネストされるためドット記法で指定する
      // (実ログ USER_AUTH_EVENTS の構造から確定)。
      fieldIndexPolicies: [
        new FieldIndexPolicy({
          fields: [
            "message.eventType",
            "message.userSub",
            "message.userName",
            "message.eventResponse",
            "message.riskDecision",
            "message.riskLevel",
            "message.ipAddress",
            "message.country",
            "message.city",
            "message.clientId",
            "message.eventId",
            "message.compromisedCredentialDetected",
          ],
        }),
      ],
    },
  );

  new CfnLogDeliveryConfiguration(monitoringStack, "CognitoLogDelivery", {
    userPoolId,
    logConfigurations: [
      {
        eventSource: "userAuthEvents",
        logLevel: "INFO",
        cloudWatchLogsConfiguration: {
          // CDK の logGroupArn は末尾に ":*" が付き Cognito の ARN パターンに合致しないため、
          // ":*" なしの ARN を組み立てて渡す
          logGroupArn: logGroupArnWithoutWildcard(
            monitoringStack,
            cognitoActivityLogGroup.logGroupName,
          ),
        },
      },
    ],
  });
}
