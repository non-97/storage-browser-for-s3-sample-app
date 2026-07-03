import { useCallback, useEffect, useState } from "react";
import {
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
  fetchMFAPreference,
} from "aws-amplify/auth";
import { Alert, Button, Flex, Text, TextField } from "@aws-amplify/ui-react";
import QRCode from "qrcode";
import { toJaAuthMessage } from "./authErrorMessages";

/** 認証アプリ (Google Authenticator 等) に表示される発行者名。 */
const APP_NAME = "Secure File Sharing";

/**
 * 認証アプリ (TOTP) の変更・移行セクション。TOTP は 1 ユーザー 1 つのみ (Cognito 仕様)
 * なので、これは「今の TOTP を新しいものへ置き換える」操作。ログイン済みの状態で使う
 * (紛失時の復旧手段ではない。復旧は管理者リセットか、パスキーでのログイン)。
 */
export function TotpSection() {
  const [preference, setPreference] = useState<string>("読み込み中...");
  const [setupUri, setSetupUri] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [sharedSecret, setSharedSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // 注意: プール全体で MFA 必須 + Managed Login で TOTP をセットアップした場合、
    // Cognito は per-user の MFA 設定 (UserMFASettingList) を populate しないため
    // fetchMFAPreference().enabled は空になる。「TOTP でログインできる = 未登録」
    // ではないので、enabled が空でも「未登録」とは表示しない。
    // (この画面の再設定フローは updateMFAPreference を呼ぶため、再設定後は反映される)
    fetchMFAPreference()
      .then((pref) => {
        const hasTotp = (pref.enabled ?? []).includes("TOTP");
        setPreference(
          hasTotp
            ? `認証アプリ (TOTP) が MFA に設定されています${pref.preferred === "TOTP" ? " (優先)" : ""}。`
            : "このアカウントは MFA (認証アプリ) でサインインします。機種変更などで認証アプリを移すときは、まだログインできるうちに下のボタンで新しい認証アプリに登録し直してください (今の認証アプリと置き換わります)。認証アプリを失ってログインできない場合は、管理者にリセットを依頼するか、登録済みのパスキーでログインしてください。",
        );
      })
      .catch(() => setPreference("MFA 設定を取得できませんでした。"));
  }, []);

  const startSetup = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const details = await setUpTOTP();
      const uri = details.getSetupUri(APP_NAME).toString();
      setSetupUri(uri);
      setSharedSecret(details.sharedSecret);
      setQrDataUrl(await QRCode.toDataURL(uri, { margin: 2, width: 200 }));
    } catch (e) {
      setError(toJaAuthMessage(e, "認証アプリの設定を開始できませんでした。"));
    } finally {
      setBusy(false);
    }
  }, []);

  const verify = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      await verifyTOTPSetup({ code });
      await updateMFAPreference({ totp: "PREFERRED" });
      setDone(true);
    } catch (e) {
      setError(toJaAuthMessage(e, "コードの検証に失敗しました。"));
    } finally {
      setBusy(false);
    }
  }, [code]);

  if (done) {
    return (
      <Alert variation="success" heading="認証アプリを登録し直しました">
        次回サインインからは、新しく登録した認証アプリのコードを使用してください。以前のコードは無効になりました。
      </Alert>
    );
  }

  return (
    <Flex direction="column" gap="small">
      <Text>{preference}</Text>
      <Alert variation="warning">
        登録し直すと、以前の認証アプリのコードは使えなくなります (置き換え)。
      </Alert>
      {!setupUri ? (
        <Button onClick={startSetup} isLoading={busy}>
          新しい認証アプリに登録し直す
        </Button>
      ) : (
        <Flex direction="column" gap="small">
          <Text>
            認証アプリで下記の QR コードを読み取るか、キーを手動で入力してください。
          </Text>
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="TOTP セットアップ QR コード"
              width={200}
              height={200}
            />
          )}
          <Text fontSize="small">
            手動入力キー: <code>{sharedSecret}</code>
          </Text>
          <TextField
            label="認証アプリに表示された 6 桁のコード"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            maxLength={6}
          />
          {error && <Alert variation="error">{error}</Alert>}
          <Button
            variation="primary"
            onClick={verify}
            isLoading={busy}
            isDisabled={code.length !== 6}
          >
            コードを確認して有効化
          </Button>
        </Flex>
      )}
      {!setupUri && error && <Alert variation="error">{error}</Alert>}
    </Flex>
  );
}
