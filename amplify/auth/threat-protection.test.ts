import { describe, it, expect } from "vitest";
import { buildRiskNotifyEmailBody } from "./threat-protection";

describe("buildRiskNotifyEmailBody", () => {
  it("見出し・案内文と Cognito のプレースホルダーを含む", () => {
    const body = buildRiskNotifyEmailBody("見出しテキスト", "案内テキスト");
    expect(body).toContain("見出しテキスト");
    expect(body).toContain("案内テキスト");
    // Cognito が実際の値に置換するプレースホルダー
    expect(body).toContain("{username}");
    expect(body).toContain("{login-time}");
    expect(body).toContain("{ip-address}");
    expect(body).toContain("{city}");
    expect(body).toContain("{country}");
  });
});
