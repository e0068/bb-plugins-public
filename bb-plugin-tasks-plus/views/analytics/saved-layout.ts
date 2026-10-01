// The analytics rows' sizes, remembered in localStorage between visits.
// Remembering is a convenience, not the feature: storage that is off or full,
// or a value from an older layout, just gives the default sizes.
import { useCallback, useState } from "react";

import { mergeSaved, parseSaved, serializeLayout, type RowLayout } from "./row-layout";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, layout: RowLayout): void {
  try {
    window.localStorage.setItem(key, serializeLayout(layout));
  } catch {
    // best-effort — the sizes simply are not remembered
  }
}

/** The layout to draw — `defaults` with the stored sizes laid over — and a setter that also stores. */
export function useSavedLayout(key: string, defaults: RowLayout): [RowLayout, (next: RowLayout) => void] {
  const [layout, setLayout] = useState(() => mergeSaved(defaults, parseSaved(read(key))));
  const save = useCallback(
    (next: RowLayout) => {
      setLayout(next);
      write(key, next);
    },
    [key],
  );
  return [layout, save];
}
