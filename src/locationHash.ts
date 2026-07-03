import type {
  StorageBrowserValue,
  StorageBrowserEventValue,
} from "@aws-amplify/ui-react-storage/browser";

// URL ハッシュ (#/shared/フォルダ/...) と Storage Browser の location を相互変換する純粋ロジック。
// window / amplify_outputs に依存しないよう引数で受け取るため、単体テストしやすい。
// これらを使う副作用側 (window.history / location) は useLocationHistory.ts にある。

/** パスの各セグメントを URI エンコードする (区切りの "/" は保持)。 */
export function encodePathSegments(raw: string): string {
  return raw
    .split("/")
    .map((seg) => (seg ? encodeURIComponent(seg) : ""))
    .join("/");
}

/** Storage Browser のイベントを URL ハッシュ文字列に変換する。 */
export function toHash(event: StorageBrowserEventValue): string {
  if (!event.location) return "#/";
  const { prefix, path } = event.location;
  return `#/${encodePathSegments(prefix)}${encodePathSegments(path ?? "")}`;
}

/**
 * ハッシュ復元に必要な amplify_outputs.json の storage.buckets[0] の最小構造。
 * paths のキーは "shared/*" 等、値は プリンシパル種別 → 権限文字列配列。
 */
export type BucketPathsConfig = {
  bucket_name: string;
  paths: Record<string, Record<string, string[]>>;
};

/**
 * URL ハッシュを Storage Browser の location 値に復元する。
 * @param hash window.location.hash に相当する文字列 ("#/..." 形式)
 * @param bucket amplify_outputs.json の storage.buckets[0] (無い場合は null を返す)
 */
export function parseHashToValue(
  hash: string,
  bucket: BucketPathsConfig | undefined,
): StorageBrowserValue | null {
  if (!hash || hash === "#" || hash === "#/") return null;
  if (!bucket) return null;

  // 不正なパーセントエンコーディング (例: #/%E0%A4%A) を含む URL でも
  // decodeURIComponent の URIError でアプリ全体が白画面にならないようにする。
  const decodeSegment = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  const rawPath = hash.slice(2).split("/").map(decodeSegment).join("/");

  const prefixes = Object.keys(bucket.paths)
    .map((p) => p.replace("/*", "/"))
    .sort((a, b) => b.length - a.length);

  for (const prefix of prefixes) {
    if (rawPath.startsWith(prefix) || rawPath === prefix.slice(0, -1)) {
      const subPath = rawPath.startsWith(prefix)
        ? rawPath.slice(prefix.length)
        : "";
      const pathKey = `${prefix}*`;
      const pathEntry = bucket.paths[pathKey];
      const allPerms = new Set<string>();
      if (pathEntry) {
        for (const perms of Object.values(pathEntry)) {
          for (const p of perms) allPerms.add(p);
        }
      }
      return {
        location: {
          bucket: bucket.bucket_name,
          prefix,
          path: subPath,
          permissions: [...allPerms] as ("delete" | "get" | "list" | "write")[],
          type: "PREFIX",
        },
      };
    }
  }
  return null;
}
