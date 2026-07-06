import { describe, it, expect } from "vitest";
import { evaluateIdleState, IDLE_TIMEOUT_MS } from "./useIdleSignOut";

describe("evaluateIdleState", () => {
  const BASE = 1_000_000_000;

  it("経過時間がタイムアウト未満ならサインアウトせず残り時間で再判定する", () => {
    const result = evaluateIdleState(BASE, BASE + 5 * 60 * 1000);
    expect(result.shouldSignOut).toBe(false);
    expect(result.nextCheckInMs).toBe(IDLE_TIMEOUT_MS - 5 * 60 * 1000);
  });

  it("経過時間がタイムアウトちょうどならサインアウトする", () => {
    const result = evaluateIdleState(BASE, BASE + IDLE_TIMEOUT_MS);
    expect(result.shouldSignOut).toBe(true);
  });

  it("経過時間がタイムアウト超過 (スリープ復帰など) ならサインアウトする", () => {
    const result = evaluateIdleState(BASE, BASE + IDLE_TIMEOUT_MS * 10);
    expect(result.shouldSignOut).toBe(true);
  });

  it("操作直後 (経過 0) はタイムアウト全長で再判定する", () => {
    const result = evaluateIdleState(BASE, BASE);
    expect(result.shouldSignOut).toBe(false);
    expect(result.nextCheckInMs).toBe(IDLE_TIMEOUT_MS);
  });

  it("最終操作時刻が不正 (NaN) ならサインアウトせず全長で再判定する", () => {
    const result = evaluateIdleState(Number.NaN, BASE);
    expect(result.shouldSignOut).toBe(false);
    expect(result.nextCheckInMs).toBe(IDLE_TIMEOUT_MS);
  });

  it("最終操作時刻が未来 (時計の巻き戻り) でも待ち時間は全長に丸める", () => {
    const result = evaluateIdleState(BASE + 60 * 1000, BASE);
    expect(result.shouldSignOut).toBe(false);
    expect(result.nextCheckInMs).toBe(IDLE_TIMEOUT_MS);
  });

  it("タイムアウト値を指定した場合はそれで判定する", () => {
    expect(evaluateIdleState(BASE, BASE + 999, 1000).shouldSignOut).toBe(false);
    expect(evaluateIdleState(BASE, BASE + 1000, 1000).shouldSignOut).toBe(true);
  });
});
