import { describe, it, expect } from "vitest";
import { toJaAuthMessage } from "./authErrorMessages";

const errorNamed = (name: string): Error =>
  Object.assign(new Error(), { name });

describe("toJaAuthMessage", () => {
  it("既知の例外名を日本語メッセージに変換する", () => {
    expect(toJaAuthMessage(errorNamed("NotAuthorizedException"), "fb")).toContain(
      "現在のパスワード",
    );
    expect(
      toJaAuthMessage(errorNamed("InvalidPasswordException"), "fb"),
    ).toContain("ポリシー");
    expect(toJaAuthMessage(errorNamed("LimitExceededException"), "fb")).toContain(
      "上限",
    );
    expect(toJaAuthMessage(errorNamed("CodeMismatchException"), "fb")).toContain(
      "確認コード",
    );
    expect(
      toJaAuthMessage(errorNamed("EnableSoftwareTokenMFAException"), "fb"),
    ).toContain("時刻同期");
  });

  it("未知の例外名は fallback を返す", () => {
    expect(toJaAuthMessage(errorNamed("SomethingUnknownException"), "予備文言")).toBe(
      "予備文言",
    );
  });

  it("Error 以外の入力でも throw せず fallback を返す", () => {
    expect(toJaAuthMessage("ただの文字列", "fb")).toBe("fb");
    expect(toJaAuthMessage(undefined, "fb")).toBe("fb");
    expect(toJaAuthMessage(null, "fb")).toBe("fb");
    expect(toJaAuthMessage(42, "fb")).toBe("fb");
  });
});
