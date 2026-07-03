import { Construct } from "constructs";
import { Token } from "aws-cdk-lib";
import { CfnUserPool, CfnUserPoolDomain } from "aws-cdk-lib/aws-cognito";
import {
  ARecord,
  IHostedZone,
  RecordTarget,
} from "aws-cdk-lib/aws-route53";

/**
 * Cognito Managed Login をカスタムドメインで提供するための設定。
 *
 * あわせてパスキー (WebAuthn) の RP ID も設定する。RP ID は auth ドメインでは
 * なく **フロント SPA のドメイン** を指定する (WebAuthn の RP ID はオリジンと
 * 同じか親ドメインである必要があり、SPA から直接登録するにはフロントドメインで
 * なければならない。フロントドメインは auth ドメインの親でもあるためログインにも使える)。
 */
export interface CognitoCustomDomainProps {
  /** Amplify が生成した L1 UserPool。ドメイン紐付けと RP ID 設定に使う */
  readonly cfnUserPool: CfnUserPool;
  /** カスタムドメイン FQDN (例: auth.storage-browser.www.non-97.net) */
  readonly domainName: string;
  /**
   * パスキー (WebAuthn) の RP ID。フロント SPA のドメインを指定する
   * (例: storage-browser.www.non-97.net)。domainName (auth ドメイン) とは別物。
   */
  readonly relyingPartyId: string;
  /**
   * カスタムドメイン用 ACM 証明書 ARN。
   * Cognito カスタムドメインは CloudFront に紐づくため **us-east-1** の証明書が必須。
   */
  readonly certificateArn: string;
  /** A エイリアスレコードを作成する公開ホストゾーン */
  readonly hostedZone: IHostedZone;
}

/**
 * Cognito Managed Login (v2) をカスタムドメインで公開する Construct。
 *
 * - `CfnUserPoolDomain` をカスタムドメイン + ManagedLoginVersion 2 で作成
 * - パスキー RP ID をカスタムドメインに設定
 * - Cognito が自動生成する CloudFront ディストリビューションを指す A エイリアスを Route53 に作成
 *
 * CloudFront リソースは自分では作らない (カスタムドメイン設定時に Cognito が自動生成・管理する)。
 */
export class CognitoCustomDomain extends Construct {
  constructor(scope: Construct, id: string, props: CognitoCustomDomainProps) {
    super(scope, id);

    if (!Token.isUnresolved(props.domainName) && !props.domainName.includes(".")) {
      throw new Error(
        `domainName は FQDN で指定してください: ${props.domainName}`,
      );
    }
    if (
      !Token.isUnresolved(props.certificateArn) &&
      !props.certificateArn.startsWith("arn:aws:acm:us-east-1:")
    ) {
      throw new Error(
        "Cognito カスタムドメインの証明書は us-east-1 の ACM 証明書である必要があります",
      );
    }

    // カスタムドメイン (Managed Login v2)。子 ID を "Resource" にして論理 ID を短くする
    const userPoolDomain = new CfnUserPoolDomain(this, "Resource", {
      userPoolId: props.cfnUserPool.ref,
      domain: props.domainName,
      managedLoginVersion: 2,
      customDomainConfig: { certificateArn: props.certificateArn },
    });

    // パスキー RP ID はフロント SPA のドメイン (auth ドメインではない)。
    // SPA から直接パスキー登録できるようにするため。
    props.cfnUserPool.webAuthnRelyingPartyId = props.relyingPartyId;

    // Route53 A エイリアス: カスタムドメイン → Cognito 管理の CloudFront
    // CloudFront のホストゾーン ID は全リージョン共通の固定値
    new ARecord(this, "AliasRecord", {
      zone: props.hostedZone,
      recordName: props.domainName,
      target: RecordTarget.fromAlias({
        bind: () => ({
          dnsName: userPoolDomain.attrCloudFrontDistribution,
          hostedZoneId: "Z2FDTNDATAQYW2",
        }),
      }),
    });
  }
}
