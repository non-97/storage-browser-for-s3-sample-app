import { describe, it, expect } from "vitest";
import type { StorageBrowserEventValue } from "@aws-amplify/ui-react-storage/browser";
import {
  encodePathSegments,
  toHash,
  parseHashToValue,
  type BucketPathsConfig,
} from "./locationHash";

const bucket: BucketPathsConfig = {
  bucket_name: "test-bucket",
  paths: {
    "shared/*": {
      authenticated: ["get", "list", "write", "delete"],
      groupsadmin: ["get", "list", "write", "delete"],
    },
    "dept-a/*": {
      groupsdepta: ["get", "list", "write"],
    },
  },
};

// 最小構造の StorageBrowserEventValue を作る (テスト用に型を通すためのキャスト)
const makeEvent = (prefix: string, path: string): StorageBrowserEventValue =>
  ({ location: { prefix, path } }) as unknown as StorageBrowserEventValue;

describe("encodePathSegments", () => {
  it("各セグメントを URI エンコードし区切りの / は保持する", () => {
    expect(encodePathSegments("shared/日本語 フォルダ/")).toBe(
      `shared/${encodeURIComponent("日本語 フォルダ")}/`,
    );
  });
});

describe("toHash", () => {
  it("location が無いイベントは #/ を返す", () => {
    expect(
      toHash({ location: undefined } as unknown as StorageBrowserEventValue),
    ).toBe("#/");
  });
});

describe("parseHashToValue", () => {
  it("空ハッシュ / # / #/ は null", () => {
    expect(parseHashToValue("", bucket)).toBeNull();
    expect(parseHashToValue("#", bucket)).toBeNull();
    expect(parseHashToValue("#/", bucket)).toBeNull();
  });

  it("bucket が undefined なら null", () => {
    expect(parseHashToValue("#/shared/x", undefined)).toBeNull();
  });

  it("日本語フォルダ名を toHash → parseHashToValue で往復できる", () => {
    const hash = toHash(makeEvent("shared/", "日本語フォルダ/"));
    const value = parseHashToValue(hash, bucket);
    expect(value?.location?.bucket).toBe("test-bucket");
    expect(value?.location?.prefix).toBe("shared/");
    expect(value?.location?.path).toBe("日本語フォルダ/");
  });

  it("不正なパーセントエンコーディングを含んでも throw しない", () => {
    expect(() => parseHashToValue("#/%E0%A4%A", bucket)).not.toThrow();
  });

  it("dept-a/ に最長一致で解決する", () => {
    const value = parseHashToValue("#/dept-a/sub", bucket);
    expect(value?.location?.prefix).toBe("dept-a/");
    expect(value?.location?.path).toBe("sub");
  });

  it("permissions は paths 配下の全プリンシパルの和集合になる", () => {
    const value = parseHashToValue("#/shared/", bucket);
    expect(new Set(value?.location?.permissions)).toEqual(
      new Set(["get", "list", "write", "delete"]),
    );
  });
});
