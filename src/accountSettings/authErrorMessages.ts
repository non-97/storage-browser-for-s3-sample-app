/**
 * Cognito (aws-amplify/auth) が投げる例外名を、利用者向けの日本語メッセージに変換する。
 * 副作用のない純粋関数なので単体テストの対象。未知の例外は fallback をそのまま返す。
 */
export function toJaAuthMessage(error: unknown, fallback: string): string {
  const name =
    error instanceof Error ? error.name : String(error ?? "UnknownError");
  switch (name) {
    case "NotAuthorizedException":
      return "現在のパスワードが正しくありません。";
    case "InvalidPasswordException":
      return "新しいパスワードがポリシーを満たしていません (16 文字以上、大文字・小文字・数字・記号を含む)。";
    case "LimitExceededException":
      return "試行回数の上限に達しました。しばらく待って再度お試しください。";
    case "CodeMismatchException":
      return "確認コードが正しくありません。認証アプリの表示を確認してください。";
    case "EnableSoftwareTokenMFAException":
      return "コードの検証に失敗しました。時刻同期を確認し、最新のコードを入力してください。";
    default:
      return fallback;
  }
}
