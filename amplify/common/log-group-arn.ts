import { ArnFormat, Stack } from "aws-cdk-lib";
import type { Construct } from "constructs";

/**
 * CloudWatch Logs のロググループ ARN を「末尾の ":*" なし」で組み立てる共通ヘルパー。
 *
 * CDK の `logGroup.logGroupArn` は末尾に ":*" が付くが、Cognito のログ配信
 * (CfnLogDeliveryConfiguration) や WAF のログ出力 (CfnLoggingConfiguration) が
 * 要求する ARN パターンは ":*" なし。両者で同じ組み立てが必要なためここに集約する。
 */
export function logGroupArnWithoutWildcard(
  scope: Construct,
  logGroupName: string,
): string {
  return Stack.of(scope).formatArn({
    service: "logs",
    resource: "log-group",
    resourceName: logGroupName,
    arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  });
}
