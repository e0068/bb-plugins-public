import { useSyncExternalStore } from "react";

/**
 * Client-local choice of which metadata columns the list row's trailing rail
 * shows. Stored in the browser profile — same boundary as the list filter and
 * view preferences (one client's choice does not rewrite another's).
 *
 * State lives in a module-level store rather than React state/context: the
 * eye-menu toggle (topbar) and the rows it controls (list body) sit in
 * separate subtrees under the shell, so a plain hook can't share state
 * between them without a provider. `useSyncExternalStore` lets every row
 * subscribe directly, mirroring the pattern in `shell/refresh.tsx`.
 */
export const ROW_FIELD_PREFERENCE_STORAGE_KEY = "bb-tasks:row-field-preferences";
export const ROW_FIELD_PREFERENCE_VERSION = 1 as const;

export type RowField =
  | "active"
  | "type"
  | "estimate"
  | "labels"
  | "tokens"
  | "dueDate"
  | "project";

export const ROW_FIELDS: readonly RowField[] = [
  "active",
  "type",
  "estimate",
  "labels",
  "tokens",
  "dueDate",
  "project",
];

export const ROW_FIELD_LABELS: Record<RowField, string> = {
  active: "Active",
  type: "Type",
  estimate: "Estimate",
  labels: "Labels",
  tokens: "Tokens",
  dueDate: "Due date",
  project: "Project",
};

const FIELD_SET = new Set<string>(ROW_FIELDS);

interface StoredDocumentV1 {
  version: typeof ROW_FIELD_PREFERENCE_VERSION;
  /** Fields hidden by the user; everything else defaults to visible. */
  hidden: string[];
}

function sanitizeHidden(values: unknown): Set<RowField> {
  const hidden = new Set<RowField>();
  if (!Array.isArray(values)) return hidden;
  for (const value of values) {
    if (typeof value === "string" && FIELD_SET.has(value)) {
      hidden.add(value as RowField);
    }
  }
  return hidden;
}

function readStorage(): Set<RowField> {
  try {
    const raw = window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Set();
    }
    const record = parsed as Record<string, unknown>;
    // No older versions shipped; a mismatched version refuses rather than
    // guessing at an unknown shape.
    if (record.version !== ROW_FIELD_PREFERENCE_VERSION) return new Set();
    return sanitizeHidden(record.hidden);
  } catch {
    return new Set();
  }
}

function writeStorage(hidden: ReadonlySet<RowField>): void {
  try {
    const document: StoredDocumentV1 = {
      version: ROW_FIELD_PREFERENCE_VERSION,
      hidden: [...hidden],
    };
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify(document),
    );
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
  }
}

let hiddenFields: Set<RowField> = readStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Set<RowField> {
  return hiddenFields;
}

/** Toggle one field's visibility; persists and notifies every subscriber. */
export function toggleRowField(field: RowField): void {
  const next = new Set(hiddenFields);
  if (next.has(field)) next.delete(field);
  else next.add(field);
  hiddenFields = next;
  writeStorage(next);
  emit();
}

/** The set of fields currently hidden from the list row rail. */
export function useHiddenRowFields(): ReadonlySet<RowField> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
