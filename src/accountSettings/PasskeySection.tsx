import { useCallback, useEffect, useState } from "react";
import {
  associateWebAuthnCredential,
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

// パスキー登録は SPA からそのまま実行する。RP ID をフロント SPA のドメインに
// 設定しているため (backend の webAuthnRelyingPartyId)、WebAuthn のオリジン制約を
// 満たし、associateWebAuthnCredential() が SPA 上で成立する。

/** パスキーの登録 (SPA から直接) / 一覧 / 削除セクション。 */
export function PasskeySection() {
  const [credentials, setCredentials] = useState<AuthWebAuthnCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
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

  const register = useCallback(async () => {
    setError("");
    setRegistering(true);
    try {
      // SPA 上でパスキー登録セレモニーを実行する (ブラウザが本人確認を求める)。
      await associateWebAuthnCredential();
      await reload();
    } catch (e) {
      setError(toJaAuthMessage(e, "パスキーの登録に失敗しました。"));
    } finally {
      setRegistering(false);
    }
  }, [reload]);

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
        パスキーを登録すると、パスキーだけでサインインできます。
      </Text>
      <Button onClick={register} isLoading={registering}>
        新しいパスキーを登録する
      </Button>
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
