import { Duration, type Stack } from "aws-cdk-lib";
import { Key } from "aws-cdk-lib/aws-kms";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Trail, ReadWriteType } from "aws-cdk-lib/aws-cloudtrail";
import { Bucket, StorageClass, type IBucket } from "aws-cdk-lib/aws-s3";
import { securityConfig } from "../app.config";

/**
 * 対象バケットの S3 データイベントを記録する CloudTrail を作成する。
 *  - 管理イベントは記録しない (データイベントのみ)
 *  - 配信ログは専用 KMS キーで暗号化 (SSE-KMS)
 *  - CloudTrail が自動生成する監査ログバケットにライフサイクルを設定
 *
 * @param monitoringStack backend.createStack("monitoring") で作ったスタック
 */
export function createAuditTrail(
  monitoringStack: Stack,
  props: { targetBucket: IBucket },
): void {
  const { targetBucket } = props;

  // 監査ログ暗号化キー (この monitoring スタック内で完結。他スタックから参照しない)。
  const auditLogKey = new Key(monitoringStack, "AuditLogKey", {
    enableKeyRotation: true,
    description: "CloudTrail audit log encryption key",
  });
  // Trail に encryptionKey を渡しても CDK はキーポリシーへ CloudTrail プリンシパルを
  // 追加しないため、手動で付与する。無いと CloudTrail のログ配信が失敗する。
  auditLogKey.addToResourcePolicy(
    new PolicyStatement({
      sid: "AllowCloudTrailEncrypt",
      principals: [new ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["kms:GenerateDataKey*"],
      resources: ["*"],
      conditions: {
        StringLike: {
          "kms:EncryptionContext:aws:cloudtrail:arn": `arn:aws:cloudtrail:*:${monitoringStack.account}:trail/*`,
        },
      },
    }),
  );
  auditLogKey.addToResourcePolicy(
    new PolicyStatement({
      sid: "AllowCloudTrailDescribeKey",
      principals: [new ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["kms:DescribeKey"],
      resources: ["*"],
    }),
  );

  // CloudTrail: 対象バケットの S3 データイベントのみ記録(管理イベントは記録しない)。
  // 配信オブジェクトは SSE-KMS で暗号化する。
  const trail = new Trail(monitoringStack, "S3DataTrail", {
    isMultiRegionTrail: false,
    managementEvents: ReadWriteType.NONE,
    encryptionKey: auditLogKey,
  });
  trail.addS3EventSelector([{ bucket: targetBucket }], {
    readWriteType: ReadWriteType.ALL,
    includeManagementEvents: false,
  });

  // Trail が自動生成した監査ログバケット (子 ID "S3"、enforceSSL 済み) に
  // ライフサイクルを追加: 一定日数で Standard-IA へ移行し、さらに一定日数で失効。
  const trailBucket = trail.node.findChild("S3") as Bucket;
  trailBucket.addLifecycleRule({
    id: "AuditLogLifecycle",
    transitions: [
      {
        storageClass: StorageClass.INFREQUENT_ACCESS,
        transitionAfter: Duration.days(securityConfig.auditIaTransitionDays),
      },
    ],
    expiration: Duration.days(securityConfig.auditExpirationDays),
  });
}
