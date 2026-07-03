import { useCallback, useEffect, useState } from "react";
import {
  listWebAuthnCredentials,
  deleteWebAuthnCredential,
  type AuthWebAuthnCredential,
} from "aws-amplify/auth";
import {
  Alert,
  Button,
  Divider,
  Flex,
  Loader,
  Text,
} from "@aws-amplify/ui-react";
import { toJaAuthMessage } from "./authErrorMessages";
import outputs from "../../amplify_outputs.json";

// パスキー登録は WebAuthn のオリジン制約上 SPA からは直接行えないため、
// Managed Login (auth ドメイン) の専用ページへリダイレクトして登録する。
const CUSTOM_AUTH_DOMAIN = (
  outputs as typeof outputs & { custom?: { customAuthDomain?: string } }
).custom?.customAuthDomain;
const CLIENT_ID = outputs.auth.user_pool_client_id;

/** パスキーの登録 (Managed Login へリダイレクト) / 一覧 / 削除セクション。 */
export function PasskeySection() {
  const [credentials, setCredentials] = useState<AuthWebAuthnCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listWebAuthnCredentials();
      setCredentials(result.credentials);
    } catch (e) {
      setError(toJaAuthMessage(e, "パスキーの一覧を取得できませんでした。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const register = useCallback(() => {
    if (!CUSTOM_AUTH_DOMAIN) {
      setError("認証ドメインが設定されていないため、パスキーを登録できません。");
      return;
    }
    // Managed Login の専用ページでパスキー登録セレモニーを実行する。
    // セレモニーは auth ドメイン上で行われ RP ID と一致するため成立する。
    const redirectUri = encodeURIComponent(window.location.origin + "/");
    window.location.href = `https://${CUSTOM_AUTH_DOMAIN}/passkeys/add?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}`;
  }, []);

  const remove = useCallback(
    async (credentialId: string | undefined) => {
      if (!credentialId) return;
      if (!window.confirm("このパスキーを削除しますか?")) return;
      try {
        await deleteWebAuthnCredential({ credentialId });
        await reload();
      } catch (e) {
        setError(toJaAuthMessage(e, "パスキーの削除に失敗しました。"));
      }
    },
    [reload],
  );

  return (
    <Flex direction="column" gap="small">
      <Text>
        パスキー (顔認証・指紋・PIN 等) を登録すると、認証アプリの代わりに追加の本人確認として使えます。
      </Text>
      <Button onClick={register}>新しいパスキーを登録する</Button>
      <Divider />
      {loading ? (
        <Loader />
      ) : credentials.length === 0 ? (
        <Text fontSize="small">登録済みのパスキーはありません。</Text>
      ) : (
        <Flex direction="column" gap="xs">
          {credentials.map((c) => (
            <Flex
              key={c.credentialId}
              justifyContent="space-between"
              alignItems="center"
            >
              <Flex direction="column" gap="0">
                <Text>{c.friendlyCredentialName || "(名称未設定のパスキー)"}</Text>
                <Text fontSize="small" color="font.tertiary">
                  登録日:{" "}
                  {c.createdAt ? c.createdAt.toLocaleString("ja-JP") : "不明"}
                </Text>
              </Flex>
              <Button
                size="small"
                variation="destructive"
                onClick={() => remove(c.credentialId)}
              >
                削除
              </Button>
            </Flex>
          ))}
        </Flex>
      )}
      {error && <Alert variation="error">{error}</Alert>}
    </Flex>
  );
}
