import type { Stack } from "aws-cdk-lib";
import {
  CfnLoggingConfiguration,
  CfnWebACL,
  CfnWebACLAssociation,
} from "aws-cdk-lib/aws-wafv2";
import {
  FieldIndexPolicy,
  LogGroup,
  RetentionDays,
} from "aws-cdk-lib/aws-logs";
import { securityConfig } from "../app.config";
import { logGroupArnWithoutWildcard } from "../common/log-group-arn";

/** WAF ルールの CloudWatch メトリクス / サンプリング設定を作るヘルパー。 */
const wafVisibility = (metricName: string) => ({
  cloudWatchMetricsEnabled: true,
  metricName,
  sampledRequestsEnabled: true,
});

// Cognito Managed Login の TOTP セットアップは AssociateSoftwareToken /
// VerifySoftwareToken を AWS インフラ (US) からバックグラウンド発行する。
// これらがジオブロック (日本以外) に引っかかると MFA 登録が回復不能に壊れる。
// 以前は優先度 0 の終端 Allow で全ルールをバイパスさせていたが、それだと
// IP レピュテーションやレート制限までバイパスされてしまうため、ジオブロック
// ルールだけから除外する scope-down 方式に変更した。IP レピュテーションと
// レート制限は TOTP 操作にも適用される。
// 参考: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html
const totpOperationHeaderMatch = (searchString: string) => ({
  byteMatchStatement: {
    searchString,
    fieldToMatch: {
      singleHeader: { name: "x-amzn-cognito-operation-name" },
    },
    textTransformations: [{ priority: 0, type: "NONE" }],
    positionalConstraint: "EXACTLY",
  },
});

/**
 * Cognito User Pool 向けの WAF (REGIONAL) を作成し、User Pool へ関連付け、
 * ログ出力 (フィールドインデックス付き) を設定する。
 *  - IP レピュテーション / レート制限 / 日本以外ブロック (TOTP 背景操作は除外)
 *
 * @param monitoringStack backend.createStack("monitoring") で作ったスタック
 */
export function attachCognitoWaf(
  monitoringStack: Stack,
  props: { userPoolArn: string },
): void {
  const { userPoolArn } = props;

  const cognitoWebAcl = new CfnWebACL(monitoringStack, "CognitoWebAcl", {
    scope: "REGIONAL",
    defaultAction: { allow: {} },
    visibilityConfig: wafVisibility("cognitoWebAcl"),
    rules: [
      {
        name: "AWSIpReputation",
        priority: 1,
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesAmazonIpReputationList",
          },
        },
        overrideAction: { none: {} },
        visibilityConfig: wafVisibility("awsIpReputation"),
      },
      {
        name: "RateLimit",
        priority: 2,
        statement: {
          rateBasedStatement: {
            // 5分間あたり同一 IP からのリクエスト上限 (app.config.ts)
            limit: securityConfig.wafRateLimitPer5Minutes,
            aggregateKeyType: "IP",
          },
        },
        action: { block: {} },
        visibilityConfig: wafVisibility("rateLimit"),
      },
      {
        // 日本以外をブロック。ただし Cognito が背景発行する TOTP 操作
        // (AssociateSoftwareToken / VerifySoftwareToken、US 発) は除外する。
        name: "BlockNonJapan",
        priority: 3,
        statement: {
          andStatement: {
            statements: [
              {
                notStatement: {
                  statement: { geoMatchStatement: { countryCodes: ["JP"] } },
                },
              },
              {
                notStatement: {
                  statement: {
                    orStatement: {
                      statements: [
                        totpOperationHeaderMatch("AssociateSoftwareToken"),
                        totpOperationHeaderMatch("VerifySoftwareToken"),
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
        action: { block: {} },
        visibilityConfig: wafVisibility("blockNonJapan"),
      },
    ],
  });

  new CfnWebACLAssociation(monitoringStack, "CognitoWebAclAssociation", {
    resourceArn: userPoolArn,
    webAclArn: cognitoWebAcl.attrArn,
  });

  // WAF ログを CloudWatch Logs へ出力する。
  // ロググループ名は "aws-waf-logs-" 始まりが必須。リソースポリシーは WAF が自動作成。
  // フィールドインデックスで Logs Insights 検索を高速化する。ja3/ja4 は
  // CloudFront/ALB 経由でのみ値が入り Cognito (REGIONAL 直結) では空になるが、
  // 運用の一貫性のためユーザー指定どおり定義しておく。
  const wafLogGroup = new LogGroup(monitoringStack, "WafLogGroup", {
    logGroupName: "aws-waf-logs-storage-browser-cognito",
    retention: RetentionDays.THREE_MONTHS,
    fieldIndexPolicies: [
      new FieldIndexPolicy({
        fields: [
          "timestamp",
          "webaclId",
          "terminatingRuleId",
          "action",
          "httpRequest.country",
          "httpRequest.clientIp",
          "httpRequest.uri",
          "httpRequest.httpMethod",
          "httpRequest.requestId",
          "httpRequest.host",
          "ja3Fingerprint",
          "ja4Fingerprint",
        ],
      }),
    ],
  });
  new CfnLoggingConfiguration(monitoringStack, "CognitoWafLogging", {
    resourceArn: cognitoWebAcl.attrArn,
    logDestinationConfigs: [
      // Cognito LogDelivery と同様に ":*" なしの ARN を渡す
      logGroupArnWithoutWildcard(monitoringStack, wafLogGroup.logGroupName),
    ],
  });
}
