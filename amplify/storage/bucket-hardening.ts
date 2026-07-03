import type { Stack } from "aws-cdk-lib";
import { Key } from "aws-cdk-lib/aws-kms";
import type { CfnBucket } from "aws-cdk-lib/aws-s3";
import type { IRole } from "aws-cdk-lib/aws-iam";
import { securityConfig } from "../app.config";

/** CORS プリフライト結果をブラウザがキャッシュする秒数。 */
const CORS_MAX_AGE_SECONDS = 3000;

/**
 * 共有ファイル用 S3 バケットを堅牢化する。
 *  - 専用 KMS キーを作成し、バケットのデフォルト暗号化 (SSE-KMS) に設定
 *  - バージョニング有効化
 *  - CORS をアプリのオリジンに限定 (Storage Browser の公式推奨設定)
 *  - ライフサイクル (Standard-IA 移行 / 非現行バージョン失効 / 未完了アップロード掃除)
 *  - Cognito の各ロールに KMS 権限を付与
 *
 * KMS キーは storage / auth スタックから参照されるため security スタックに置く
 * (循環参照を避けるための配置。security スタックは他スタックを参照しない)。
 *
 * @param securityStack backend.createStack("security") で作ったスタック
 */
export function hardenSharedFilesBucket(
  securityStack: Stack,
  props: {
    cfnBucket: CfnBucket;
    authenticatedRole: IRole;
    groupRoles: IRole[];
  },
): void {
  const { cfnBucket, authenticatedRole, groupRoles } = props;

  const storageKey = new Key(securityStack, "StorageEncryptionKey", {
    enableKeyRotation: true,
    description: "Shared files bucket encryption key",
  });

  // S3 バケット: バージョニング + SSE-KMS
  cfnBucket.versioningConfiguration = { status: "Enabled" };
  cfnBucket.bucketEncryption = {
    serverSideEncryptionConfiguration: [
      {
        serverSideEncryptionByDefault: {
          sseAlgorithm: "aws:kms",
          kmsMasterKeyId: storageKey.keyArn,
        },
        // Bucket Key で KMS API 呼び出しコストを削減
        bucketKeyEnabled: true,
      },
    ],
  };

  // CORS: Storage Browser for S3 の公式推奨設定。オリジンはアプリの URL に限定する
  // (公式もオリジン限定を推奨)。exposedHeaders の etag はマルチパートアップロードに必須。
  cfnBucket.corsConfiguration = {
    corsRules: [
      {
        allowedOrigins: [...securityConfig.appOrigins],
        allowedMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
        allowedHeaders: ["*"],
        exposedHeaders: [
          "last-modified",
          "content-type",
          "content-length",
          "etag",
          "x-amz-version-id",
          "x-amz-request-id",
          "x-amz-id-2",
          "x-amz-cf-id",
          "x-amz-storage-class",
          "date",
          "access-control-expose-headers",
        ],
        maxAge: CORS_MAX_AGE_SECONDS,
      },
    ],
  };

  // ライフサイクル:
  //  - 現行オブジェクトは一定日数で Standard-IA へ移行 (128KB 未満は S3 既定で移行対象外)
  //  - 非現行バージョン (削除・上書き前の旧版。ユーザーには見えない) を一定日数で失効
  //  - 未完了マルチパートアップロードを中止 / 期限切れ削除マーカーを掃除
  // ExpiredObjectDeleteMarker と Expiration は同一ルールに書けないためルールを分ける。
  cfnBucket.lifecycleConfiguration = {
    rules: [
      {
        id: "TransitionCurrentToIA",
        status: "Enabled",
        transitions: [
          {
            storageClass: "STANDARD_IA",
            transitionInDays: securityConfig.dataIaTransitionDays,
          },
        ],
      },
      {
        id: "CleanupVersions",
        status: "Enabled",
        noncurrentVersionExpiration: {
          noncurrentDays: securityConfig.dataNoncurrentVersionExpirationDays,
        },
        abortIncompleteMultipartUpload: {
          daysAfterInitiation: securityConfig.dataAbortIncompleteUploadDays,
        },
        expiredObjectDeleteMarker: true,
      },
    ],
  };

  // 重要: Cognito の全ロールに KMS 権限を付与する
  // これを忘れるとバケットへの全操作が AccessDenied になる
  storageKey.grantEncryptDecrypt(authenticatedRole);
  for (const role of groupRoles) {
    storageKey.grantEncryptDecrypt(role);
  }
}
