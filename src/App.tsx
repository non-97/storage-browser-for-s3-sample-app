import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentUser,
  fetchUserAttributes,
  signInWithRedirect,
  signOut,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import "@aws-amplify/ui-react/styles.css";
import "@aws-amplify/ui-react-storage/styles.css";
import "./App.css";
import { StorageBrowserView } from "./StorageBrowserView";
import { AccountSettingsView } from "./accountSettings/AccountSettingsView";
import { useIdleSignOut } from "./useIdleSignOut";

type AuthState = "loading" | "authenticated" | "redirecting" | "error";
type View = "files" | "settings";

function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [email, setEmail] = useState<string>("");
  const [view, setView] = useState<View>("files");
  const loadingRef = useRef(false);

  // 無操作 15 分で自動サインアウト (認証済みのときのみ有効)
  useIdleSignOut(authState === "authenticated");

  const loadUser = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      try {
        await getCurrentUser();
      } catch {
        setAuthState("redirecting");
        signInWithRedirect({ options: { lang: "ja" } }).catch(() => {
          setAuthState("error");
        });
        return;
      }

      setAuthState("authenticated");
      try {
        const attrs = await fetchUserAttributes();
        setEmail(attrs.email ?? "");
      } catch {
        // メール取得失敗は致命的ではない
      }
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signInWithRedirect") {
        loadUser();
      }
    });

    loadUser();
    return unsubscribe;
  }, [loadUser]);

  if (authState === "loading") {
    return <div className="app-status">読み込み中...</div>;
  }
  if (authState === "redirecting") {
    return <div className="app-status">ログインページに移動しています...</div>;
  }
  if (authState === "error") {
    return (
      <div className="app-status">
        <p>認証に失敗しました。</p>
        <button onClick={() => window.location.reload()}>再読み込み</button>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="app-header">
        <h1>共有ファイル管理</h1>
        <div className="header-user">
          {email && <span className="user-email">{email}</span>}
          <button
            className="header-button"
            onClick={() =>
              setView((v) => (v === "files" ? "settings" : "files"))
            }
          >
            {view === "files" ? "アカウント設定" : "ファイル一覧"}
          </button>
          <button className="signout-button" onClick={() => signOut()}>
            ログアウト
          </button>
        </div>
      </header>
      <main className="app-main">
        {/* StorageBrowserView は状態 (現在フォルダ等) を保持したいので
            アンマウントせず CSS で表示を切り替える。設定画面は上に重ねて表示。 */}
        <div style={{ display: view === "files" ? "contents" : "none" }}>
          <StorageBrowserView />
        </div>
        {view === "settings" && (
          <AccountSettingsView onBack={() => setView("files")} />
        )}
      </main>
    </div>
  );
}

export default App;
