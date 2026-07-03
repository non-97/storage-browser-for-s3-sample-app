import { useEffect, useRef } from "react";
import { signOut } from "aws-amplify/auth";

/** 無操作でサインアウトするまでの時間 (ミリ秒)。庁内共用端末の放置対策。 */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

// 操作とみなすイベント。passive で登録しスクロール等を妨げない。
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
];

/**
 * 一定時間 (IDLE_TIMEOUT_MS) 無操作が続いたら signOut() を呼ぶ。
 * enabled が false の間はタイマーもリスナーも張らない。
 */
export function useIdleSignOut(enabled: boolean): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const clear = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
    const schedule = () => {
      clear();
      timerRef.current = setTimeout(() => {
        // グローバルではなく当該ブラウザのセッションのみサインアウト
        signOut().catch(() => {
          // サインアウト失敗時はリロードで認証チェックへ戻す
          window.location.reload();
        });
      }, IDLE_TIMEOUT_MS);
    };

    schedule();
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, schedule, { passive: true });
    }

    return () => {
      clear();
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, schedule);
      }
    };
  }, [enabled]);
}
