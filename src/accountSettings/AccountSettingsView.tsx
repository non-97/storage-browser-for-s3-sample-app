import { Button, Card, Divider, Flex, Heading, View } from "@aws-amplify/ui-react";
import { PasswordSection } from "./PasswordSection";
import { TotpSection } from "./TotpSection";
import { PasskeySection } from "./PasskeySection";

type Props = {
  /** ファイル一覧へ戻るときに呼ばれる。 */
  onBack: () => void;
};

/**
 * アカウント設定画面。3 つのセクション (パスワード変更 / 認証アプリ再設定 / パスキー) を
 * カードで並べるだけのレイアウト。各セクションのロジックは同ディレクトリの個別ファイル。
 */
export function AccountSettingsView({ onBack }: Props) {
  return (
    <View padding="medium" maxWidth="720px" margin="0 auto">
      <Flex justifyContent="space-between" alignItems="center">
        <Heading level={2}>アカウント設定</Heading>
        <Button onClick={onBack}>ファイル一覧へ戻る</Button>
      </Flex>

      <Card variation="outlined" marginTop="medium">
        <Heading level={4}>パスワードの変更</Heading>
        <Divider marginBlock="small" />
        <PasswordSection />
      </Card>

      <Card variation="outlined" marginTop="medium">
        <Heading level={4}>認証アプリ (TOTP) の再設定</Heading>
        <Divider marginBlock="small" />
        <TotpSection />
      </Card>

      <Card variation="outlined" marginTop="medium">
        <Heading level={4}>パスキー</Heading>
        <Divider marginBlock="small" />
        <PasskeySection />
      </Card>
    </View>
  );
}
