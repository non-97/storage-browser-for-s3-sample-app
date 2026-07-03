import { useCallback, useEffect, useState } from "react";
import type {
  StorageBrowserValue,
  StorageBrowserEventValue,
} from "@aws-amplify/ui-react-storage/browser";
import outputs from "../amplify_outputs.json";
import { parseHashToValue, toHash } from "./locationHash";

// このフックは window.history / window.location というブラウザの副作用を扱う。
// ハッシュ ↔ location の純粋な変換ロジックは locationHash.ts に分離してある。

function resolveInitialValue(): StorageBrowserValue | null | undefined {
  // history.state からの復元を優先(戻る/進むボタン、同一タブ内リロード)
  const sbEvent = window.history.state?.sbEvent as
    | StorageBrowserEventValue
    | undefined;
  if (sbEvent?.location) {
    return { actionType: sbEvent.actionType, location: sbEvent.location };
  }
  // history.state がない場合はハッシュ URL から復元(URL 共有、別タブで開いた場合)
  return parseHashToValue(window.location.hash, outputs.storage?.buckets?.[0]);
}

export function useLocationHistory() {
  const [defaultValue, setDefaultValue] = useState<
    StorageBrowserValue | null | undefined
  >(resolveInitialValue);
  const [browserKey, setBrowserKey] = useState(0);

  const onValueChange = useCallback((event: StorageBrowserEventValue) => {
    const hash = toHash(event);
    if (window.location.hash !== hash) {
      window.history.pushState({ sbEvent: event }, "", hash);
    }
  }, []);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.sbEvent) {
        const event = e.state.sbEvent as StorageBrowserEventValue;
        if (event.location) {
          setDefaultValue({
            actionType: event.actionType,
            location: event.location,
          });
        } else {
          setDefaultValue(null);
        }
      } else {
        setDefaultValue(null);
      }
      setBrowserKey((k) => k + 1);
    };

    window.addEventListener("popstate", handlePopState);

    if (!window.history.state?.sbEvent) {
      window.history.replaceState(
        { sbEvent: { actionType: undefined, location: undefined } },
        "",
        window.location.hash || "#/",
      );
    }

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return { defaultValue, browserKey, onValueChange };
}
