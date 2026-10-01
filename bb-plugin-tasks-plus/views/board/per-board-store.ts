import { useMemo, useSyncExternalStore } from "react";

/** A preference kept one per board in the browser profile, read reactively. */
export interface PerBoardStore<T> {
  load: (boardKey: string) => T;
  set: (boardKey: string, value: T) => void;
  use: (boardKey: string) => T;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored value when it is one of the options, the fallback otherwise. */
export const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/**
 * A per-board preference under one localStorage key: a map of board keys to
 * values, each read back through `parse`, so junk or an older shape falls
 * back to what `parse` makes of it. Writing is best-effort, as for the board
 * layouts; a write tells every reader to look again.
 */
export function perBoardStore<T>(storageKey: string, parse: (raw: unknown) => T): PerBoardStore<T> {
  const readBoards = (): Record<string, unknown> => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getGeneration = () => generation;
  const load = (key: string) => parse(readBoards()[key]);
  return {
    load,
    set(key, value) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ ...readBoards(), [key]: parse(value) }));
      } catch {
        // Persistence is best-effort.
      }
      generation += 1;
      for (const listener of listeners) listener();
    },
    use(key) {
      const seen = useSyncExternalStore(subscribe, getGeneration, getGeneration);
      // `seen` is the change counter: a new value means storage may hold a new preference.
      return useMemo(() => load(key), [key, seen]);
    },
  };
}
