import { useEffect, useRef } from "react";
import { signOut } from "aws-amplify/auth";

/** 無操作でサインアウトするまでの時間 (ミリ秒)。庁内共用端末の放置対策。 */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 最終操作時刻 (epoch ms) を全タブで共有する localStorage キー。
 * タブごとに独立してタイマーを持つと、放置タブの発火が作業中のタブごと
 * サインアウトさせてしまうため、操作時刻を共有して実経過時間で判定する。
 */
export const LAST_ACTIVITY_STORAGE_KEY = "secure-file-sharing:lastActivity";

/** 最終操作時刻の書き込みを間引く間隔 (ミリ秒)。連続操作での高頻度書き込みを避ける。 */
const ACTIVITY_WRITE_THROTTLE_MS = 1000;

// 操作とみなすイベント。passive で登録しスクロール等を妨げない。
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
];

/**
 * 最終操作時刻と現在時刻から「サインアウトすべきか / 次の判定までの待ち時間」を
 * 返す純粋関数。setTimeout はスリープ中に止まり得るため、タイマー発火時や
 * タブ復帰時にこの関数で実経過時間を判定し直す。
 * 最終操作時刻が不正 (NaN 等) な場合は安全側 (サインアウトしない) に倒し、
 * タイムアウト全長で再判定する。時計の巻き戻り等で未来の値になっていた場合も
 * 待ち時間はタイムアウト全長に丸める。
 */
export function evaluateIdleState(
  lastActivityMs: number,
  nowMs: number,
  timeoutMs: number = IDLE_TIMEOUT_MS,
): { shouldSignOut: boolean; nextCheckInMs: number } {
  if (!Number.isFinite(lastActivityMs)) {
    return { shouldSignOut: false, nextCheckInMs: timeoutMs };
  }
  const elapsedMs = nowMs - lastActivityMs;
  if (elapsedMs >= timeoutMs) {
    return { shouldSignOut: true, nextCheckInMs: 0 };
  }
  return {
    shouldSignOut: false,
    nextCheckInMs: Math.min(timeoutMs, timeoutMs - elapsedMs),
  };
}

/**
 * 一定時間 (IDLE_TIMEOUT_MS) 無操作が続いたら signOut() を呼ぶ。
 * enabled が false の間はタイマーもリスナーも張らない。
 * 最終操作時刻は localStorage で全タブ共有し、いずれかのタブで操作があれば
 * サインアウトしない。localStorage が使えない環境ではタブ内の記録に
 * フォールバックする (従来どおりタブ単位の判定になる)。
 */
export function useIdleSignOut(enabled: boolean): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWriteRef = useRef(0);
  // localStorage が使えない場合のフォールバック (このタブの最終操作時刻)
  const memoryLastActivityRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const readLastActivity = (): number => {
      const fromStorage = (() => {
        try {
          return Number(window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY));
        } catch {
          return Number.NaN;
        }
      })();
      // getItem が null (未記録) だと Number(null) === 0 になるため、
      // メモリ側の値との max を取ればマウント時の記録が必ず生きる
      return Number.isFinite(fromStorage)
        ? Math.max(fromStorage, memoryLastActivityRef.current)
        : memoryLastActivityRef.current;
    };

    const writeLastActivity = (nowMs: number) => {
      memoryLastActivityRef.current = nowMs;
      try {
        window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(nowMs));
      } catch {
        // 書けない環境ではメモリ側のみで判定する
      }
    };

    const clear = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };

    // 実経過時間で判定し、期限内なら残り時間で再スケジュールする
    const check = () => {
      clear();
      const { shouldSignOut, nextCheckInMs } = evaluateIdleState(
        readLastActivity(),
        Date.now(),
      );
      if (shouldSignOut) {
        // グローバルではなく当該ブラウザのセッションのみサインアウト
        signOut().catch(() => {
          // サインアウト失敗時はリロードで認証チェックへ戻す
          window.location.reload();
        });
        return;
      }
      timerRef.current = setTimeout(check, nextCheckInMs);
    };

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteRef.current = now;
      writeLastActivity(now);
      check();
    };

    // スリープ / バックグラウンドからの復帰時は setTimeout が止まっていた可能性が
    // あるため、visible になった時点で実経過時間を即判定する
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") check();
    };

    // マウント (サインイン直後) 時点を操作とみなす
    writeLastActivity(Date.now());
    check();

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clear();
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, recordActivity);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);
}
