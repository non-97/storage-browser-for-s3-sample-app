import { defineAuth } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      // Managed Login を有効化するために externalProviders + domainPrefix の指定が必須。
      // ただしこの domainPrefix 値は実際には使われず (Amplify がハッシュ名のドメインを
      // 自動生成する)、CloudFormation にも渡らない。アカウント ID 等は埋め込まない。
      domainPrefix: "storage-browser-app",
      // TODO: Amplify Hosting デプロイ時に本番 URL を追加すること
      callbackUrls: ["http://localhost:5173/"],
      logoutUrls: ["http://localhost:5173/"],
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
