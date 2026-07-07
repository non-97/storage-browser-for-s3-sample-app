import { defineAuth } from "@aws-amplify/backend";
import { securityConfig } from "../app.config";

// OAuth のリダイレクト先。CORS と同じオリジン一覧 (app.config.ts の appOrigins) から
// 導出し、環境固有値の二重管理を避ける。フロントは window.location.origin に一致する
// URL をこの配列から選んでリダイレクトに使う (src/main.tsx)。
const redirectUrls = securityConfig.appOrigins.map((origin) => `${origin}/`);

export const auth = defineAuth({
  loginWith: {
    // 確認コードメール (パスワードリセット / 属性変更の確認コードに共通) を日本語化する。
    // 用途を特定できない共用テンプレートのため、汎用の操作案内を入れる。
    // HTML として描画されるため改行は <br>。createCode() は 1 回だけ呼ぶ。
    email: {
      verificationEmailStyle: "CODE",
      verificationEmailSubject: "【Secure File Sharing】確認コード",
      verificationEmailBody: (createCode) =>
        `Secure File Sharing の確認コードは ${createCode()} です。<br>` +
        "アプリのサインイン画面で、求められた欄にこの確認コードを入力して操作を続けてください。<br>" +
        "心当たりがない場合は、このメールを無視してください。",
    },
    externalProviders: {
      // Managed Login を有効化するために externalProviders + domainPrefix の指定が必須。
      // ただしこの domainPrefix 値は実際には使われず (Amplify がハッシュ名のドメインを
      // 自動生成する)、CloudFormation にも渡らない。アカウント ID 等は埋め込まない。
      domainPrefix: "storage-browser-app",
      // 本番 (Amplify Hosting カスタムドメイン) と開発 (Vite) の両方を許可する。
      // 本番 origin が無いとログインのリダイレクトが失敗する。
      // localhost はローカル開発用 (厳格化時は appOrigins から削除)。
      callbackUrls: redirectUrls,
      logoutUrls: redirectUrls,
    },
  },
  // MFA 必須(TOTP)。パスキー(ユーザー検証あり)も MFA を満たす要素として利用可(backend.ts で設定)
  multifactor: {
    mode: "REQUIRED",
    totp: true,
  },
  // 部門を表す Cognito グループ(配列順が precedence = 先頭が最上位)
  groups: ["admin", "dept-a", "dept-b"],
});
