import { defineAuth } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      // Managed Login を有効化するために externalProviders + domainPrefix の指定が必須。
      // ただしこの domainPrefix 値は実際には使われず (Amplify がハッシュ名のドメインを
      // 自動生成する)、CloudFormation にも渡らない。アカウント ID 等は埋め込まない。
      domainPrefix: "storage-browser-app",
      // 本番 (Amplify Hosting カスタムドメイン) と開発 (Vite) の両方を許可する。
      // フロントは window.location.origin に一致する URL をこの配列から選んで
      // OAuth リダイレクトに使う (src/main.tsx)。本番 origin が無いとログインの
      // リダイレクトが失敗する。localhost はローカル開発用 (厳格化時は削除可)。
      callbackUrls: [
        "https://storage-browser.www.non-97.net/",
        "http://localhost:5173/",
      ],
      logoutUrls: [
        "https://storage-browser.www.non-97.net/",
        "http://localhost:5173/",
      ],
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
