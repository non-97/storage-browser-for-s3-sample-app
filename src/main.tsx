import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import "./index.css";
import App from "./App.tsx";

// amplify_outputs.json の oauth.domain は Cognito プレフィックスドメインを指す。
// パスキーの RP ID はカスタムドメインに設定しているため、Managed Login も
// カスタムドメインで提供させる必要がある。カスタムドメイン名は backend.addOutput で
// custom.customAuthDomain に書き出しており、それがあれば configure 前に上書きする
// (元の JSON は破壊せずスプレッドで新しい設定を組み立てる)。
const customAuthDomain = (
  outputs as typeof outputs & { custom?: { customAuthDomain?: string } }
).custom?.customAuthDomain;

const config = customAuthDomain
  ? {
      ...outputs,
      auth: {
        ...outputs.auth,
        oauth: {
          ...outputs.auth.oauth,
          domain: customAuthDomain,
        },
      },
    }
  : outputs;

Amplify.configure(config);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
