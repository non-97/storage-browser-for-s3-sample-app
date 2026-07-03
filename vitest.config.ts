import { defineConfig } from "vitest/config";

// 純粋ロジック (副作用なし・window 非依存の関数) の単体テスト。
// src/ と amplify/ の *.test.ts を対象にする。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "amplify/**/*.test.ts"],
  },
});
