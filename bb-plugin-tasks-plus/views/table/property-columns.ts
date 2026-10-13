import { useCallback, useSyncExternalStore } from "react";
// Type-only, as columns.ts: the frontend bundle stays clear of contract.ts's runtime.
import type { Task } from "../../shared/contract.js";

/**
 * The table's property columns: a column for every property name the records
 * on screen have, after the regular columns, minus the ones hidden. Hidden
 * names are kept per board in the browser profile, like the rest of the
 * table's look. See
 * docs/specs/tasks-svoi-polya-zapisi-iz-frontmatter-setka-svoistva-v-kart.md, node `propertyColumns`.
 */

export const PROPERTY_COLUMN_WIDTH = 140;

/** Every property name the tasks have, alphabetically. */
export const propertyKeys = (tasks: readonly Pick<Task, "properties">[]): string[] =>
  [...new Set(tasks.flatMap((task) => Object.keys(task.properties ?? {})))].sort((a, b) => a.localeCompare(b));

/** The names drawn as columns: all of them but the hidden. */
export const shownProperties = (keys: readonly string[], hidden: readonly string[]): string[] => {
  const off = new Set(hidden);
  return keys.filter((key) => !off.has(key));
};

/** `hidden` with `key` turned the other way. */
export const toggledHidden = (hidden: readonly string[], key: string): string[] =>
  hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key];

// ---------------------------------------------------------------------------
// Shell: the hidden names in the browser profile
// ---------------------------------------------------------------------------

export const HIDDEN_PROPERTIES_STORAGE_KEY = "bb-tasks:hidden-properties";

type HiddenByBoard = Readonly<Record<string, readonly string[]>>;

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: HiddenByBoard = {};

function read(): HiddenByBoard {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(HIDDEN_PROPERTIES_STORAGE_KEY);
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    cached =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.fromEntries(
            Object.entries(parsed).map(([board, names]) => [board, Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []]),
          )
        : {};
  } catch {
    cached = {};
  }
  return cached;
}

function write(next: HiddenByBoard): void {
  localStorage.setItem(HIDDEN_PROPERTIES_STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const NONE: readonly string[] = [];

/** The property names hidden on a board's table (`null` — the table of every board), and a way to toggle one. */
export function useHiddenProperties(boardId: string | null): { hidden: readonly string[]; toggle: (key: string) => void } {
  const board = boardId ?? "*";
  const hidden = useSyncExternalStore(subscribe, () => read()[board] ?? NONE, () => NONE);
  const toggle = useCallback((key: string) => write({ ...read(), [board]: toggledHidden(read()[board] ?? NONE, key) }), [board]);
  return { hidden, toggle };
}
