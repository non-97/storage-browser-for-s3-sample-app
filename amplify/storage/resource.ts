import { defineStorage } from "@aws-amplify/backend";
import { securityConfig } from "../app.config";

export const storage = defineStorage({
  name: "sharedFiles",
  // 削除保護。Amplify がこの値で removalPolicy (RETAIN/DESTROY) と autoDeleteObjects を
  // 正しく連動させる。true なら RETAIN + autoDelete 無効、false なら DESTROY + autoDelete。
  // 手動で cfnBucket に removalPolicy を当てると autoDeleteObjects と衝突するため、
  // バケットの削除保護はこの公式プロパティで行う。
  // sandbox では Amplify がこの値を無視して常に DESTROY にする (使い捨て)。
  keepOnDelete: securityConfig.deletionProtection,
  access: (allow) => ({
    // 全社共有: グループ所属者は authenticated ロールではなくグループロールを使うため、
    // グループごとにも明示的に許可する必要がある
    "shared/*": [
      allow.authenticated.to(["read", "write", "delete"]),
      allow.groups(["admin", "dept-a", "dept-b"]).to(["read", "write", "delete"]),
    ],
    "dept-a/*": [
      allow.groups(["dept-a", "admin"]).to(["read", "write", "delete"]),
    ],
    "dept-b/*": [
      allow.groups(["dept-b", "admin"]).to(["read", "write", "delete"]),
    ],
  }),
});
