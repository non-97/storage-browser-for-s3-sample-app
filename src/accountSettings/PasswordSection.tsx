import { useCallback, useState } from "react";
import { updatePassword, signOut } from "aws-amplify/auth";
import { Alert, Button, Flex, Text, TextField } from "@aws-amplify/ui-react";
import { toJaAuthMessage } from "./authErrorMessages";

/** パスワード変更セクション。変更成功時に全デバイスをサインアウトする。 */
export function PasswordSection() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    setError("");
    if (newPassword !== confirm) {
      setError("新しいパスワードと確認用パスワードが一致しません。");
      return;
    }
    setBusy(true);
    try {
      await updatePassword({ oldPassword, newPassword });
      setDone(true);
      // 変更成功後は全デバイスをサインアウトして再ログインを促す (乗っ取り対策)
      setTimeout(() => {
        signOut({ global: true }).catch(() => window.location.reload());
      }, 2500);
    } catch (e) {
      setError(toJaAuthMessage(e, "パスワードの変更に失敗しました。"));
    } finally {
      setBusy(false);
    }
  }, [oldPassword, newPassword, confirm]);

  if (done) {
    return (
      <Alert variation="success" heading="パスワードを変更しました">
        セキュリティのため、すべての端末からサインアウトします。新しいパスワードで再度サインインしてください。
      </Alert>
    );
  }

  return (
    <Flex direction="column" gap="small">
      <Text>
        現在のパスワードと新しいパスワードを入力してください。変更後はすべての端末からサインアウトされます。
      </Text>
      <TextField
        label="現在のパスワード"
        type="password"
        value={oldPassword}
        onChange={(e) => setOldPassword(e.target.value)}
        autoComplete="current-password"
      />
      <TextField
        label="新しいパスワード"
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        autoComplete="new-password"
        descriptiveText="16 文字以上。大文字・小文字・数字・記号を含めてください。"
      />
      <TextField
        label="新しいパスワード (確認)"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
      />
      {error && <Alert variation="error">{error}</Alert>}
      <Button
        variation="primary"
        onClick={submit}
        isLoading={busy}
        isDisabled={!oldPassword || !newPassword || !confirm}
      >
        パスワードを変更する
      </Button>
    </Flex>
  );
}
