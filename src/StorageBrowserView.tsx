import {
  createAmplifyAuthAdapter,
  createStorageBrowser,
} from "@aws-amplify/ui-react-storage/browser";
import { jaDisplayText } from "./displayText";
import { useLocationHistory } from "./useLocationHistory";

let cached: ReturnType<typeof createStorageBrowser> | null = null;

function getStorageBrowser() {
  if (!cached) {
    cached = createStorageBrowser({
      config: createAmplifyAuthAdapter(),
    });
  }
  return cached;
}

export function StorageBrowserView() {
  const { StorageBrowser } = getStorageBrowser();
  const { defaultValue, browserKey, onValueChange } = useLocationHistory();

  return (
    <StorageBrowser
      key={browserKey}
      displayText={jaDisplayText}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
    />
  );
}
