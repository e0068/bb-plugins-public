import { useCallback, useSyncExternalStore } from "react";

/**
 * Which view a section's record opens in — Kasimov or the task card — kept in
 * the browser profile for every section, like the rest of the board's look
 * (docs/specs/BBPL-901-tasks-zapis-tablicy-otkryvaetsya-kasimovym.md, node `detailView`).
 */

export type RecordViewer = "kasimov" | "card";

export const RECORD_VIEWER_STORAGE_KEY = "bb-tasks:record-viewer";

/** A stored value read back: anything but "card" is Kasimov, the default. */
export const parseRecordViewer = (raw: string | null): RecordViewer => (raw === "card" ? "card" : "kasimov");

const listeners = new Set<() => void>();

const read = (): RecordViewer =>
  parseRecordViewer(typeof localStorage === "undefined" ? null : localStorage.getItem(RECORD_VIEWER_STORAGE_KEY));

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useRecordViewer(): [RecordViewer, (viewer: RecordViewer) => void] {
  const viewer = useSyncExternalStore(subscribe, read, () => "kasimov" as const);
  const choose = useCallback((next: RecordViewer) => {
    localStorage.setItem(RECORD_VIEWER_STORAGE_KEY, next);
    listeners.forEach((notify) => notify());
  }, []);
  return [viewer, choose];
}
