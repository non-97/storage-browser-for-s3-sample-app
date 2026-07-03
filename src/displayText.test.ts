import { describe, it, expect } from "vitest";
import { jaDisplayText } from "./displayText";

// 意図的に空文字にしているキー (キャンセルボタン列のヘッダーは表示なしが正しい)。
// これらは「日本語化漏れ」ではないので非空チェックから除外する。
const INTENTIONALLY_EMPTY_KEYS = new Set(["tableColumnCancelHeader"]);

/** displayText を再帰走査し、[パス, 文字列] を集める (関数値はスキップ)。 */
function collectStrings(
  value: unknown,
  path: string,
  acc: { path: string; text: string }[],
): void {
  if (typeof value === "string") {
    acc.push({ path, text: value });
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectStrings(v, k, acc);
  }
}

describe("jaDisplayText", () => {
  it("日本語化漏れがない (意図的な空ヘッダーを除き全ての文言が非空)", () => {
    const strings: { path: string; text: string }[] = [];
    collectStrings(jaDisplayText, "root", strings);

    // 十分な数の文言が定義されていること (回帰でごっそり欠落していないかの下限)
    expect(strings.length).toBeGreaterThan(20);

    const unexpectedEmpty = strings.filter(
      (s) => s.text.length === 0 && !INTENTIONALLY_EMPTY_KEYS.has(s.path),
    );
    expect(unexpectedEmpty).toEqual([]);
  });
});
