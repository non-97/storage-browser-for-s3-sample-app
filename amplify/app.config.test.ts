import { describe, it, expect } from "vitest";
import { securityConfig, validateSecurityConfig } from "./app.config";

// 現行の設定値をベースに、1 項目だけ差し替えて検証するヘルパー。
const withOverrides = (
  overrides: Partial<{
    dataIaTransitionDays: number;
    auditIaTransitionDays: number;
    auditExpirationDays: number;
    wafRateLimitPer5Minutes: number;
  }>,
) => ({
  dataIaTransitionDays: securityConfig.dataIaTransitionDays,
  auditIaTransitionDays: securityConfig.auditIaTransitionDays,
  auditExpirationDays: securityConfig.auditExpirationDays,
  wafRateLimitPer5Minutes: securityConfig.wafRateLimitPer5Minutes,
  ...overrides,
});

describe("validateSecurityConfig", () => {
  it("現行の設定値では例外を投げない", () => {
    expect(() => validateSecurityConfig(withOverrides({}))).not.toThrow();
  });

  it("データバケットの IA 移行が 30 日未満なら例外", () => {
    expect(() =>
      validateSecurityConfig(withOverrides({ dataIaTransitionDays: 29 })),
    ).toThrow();
    expect(() =>
      validateSecurityConfig(withOverrides({ dataIaTransitionDays: 30 })),
    ).not.toThrow();
  });

  it("監査ログの IA 移行が 30 日未満なら例外", () => {
    expect(() =>
      validateSecurityConfig(withOverrides({ auditIaTransitionDays: 29 })),
    ).toThrow();
  });

  it("監査ログの失効日数が IA 移行日数以下なら例外", () => {
    expect(() =>
      validateSecurityConfig(
        withOverrides({ auditIaTransitionDays: 90, auditExpirationDays: 90 }),
      ),
    ).toThrow();
    expect(() =>
      validateSecurityConfig(
        withOverrides({ auditIaTransitionDays: 90, auditExpirationDays: 91 }),
      ),
    ).not.toThrow();
  });

  it("WAF レート制限が 10 未満なら例外", () => {
    expect(() =>
      validateSecurityConfig(withOverrides({ wafRateLimitPer5Minutes: 9 })),
    ).toThrow();
    expect(() =>
      validateSecurityConfig(withOverrides({ wafRateLimitPer5Minutes: 10 })),
    ).not.toThrow();
  });
});
