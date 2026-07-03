import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "sharedFiles",
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
