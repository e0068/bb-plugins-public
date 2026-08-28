import { useMemo } from "react";
import { useSyncExternalStore } from "react";

/**
 * Client-local choice of which task fields a surface shows, in what order, and
 * whether empty fields collapse or render a placeholder. Stored in the browser
 * profile — the same boundary as the list filter and view preferences (one
 * client's choice does not rewrite another's).
 *
 * The order is data, not JSX: the display menu reorders fields by drag, and the
 * list row / board card render their rail by walking this config. State lives in
 * a module-level store so the menu and the surfaces it controls — separate
 * subtrees under the shell — share it through `useSyncExternalStore` without a
 * provider, mirroring `shell/refresh.tsx`.
 */
export const ROW_FIELD_PREFERENCE_STORAGE_KEY = "bb-tasks:row-field-preferences";
export const ROW_FIELD_PREFERENCE_VERSION = 2 as const;

export type RowField =
  | "priority"
  | "active"
  | "type"
  | "estimate"
  | "labels"
  | "tokens"
  | "dueDate"
  | "project"
  | "createdAt"
  | "updatedAt";

/**
 * Canonical field order. A surface's default order is this list; stored configs
 * keep their own order and gain any field added here later, appended hidden so a
 * new field never surfaces itself on existing clients.
 */
export const CANONICAL_FIELD_ORDER: readonly RowField[] = [
  "priority",
  "active",
  "type",
  "estimate",
  "labels",
  "tokens",
  "dueDate",
  "project",
  "createdAt",
  "updatedAt",
];

export const ROW_FIELD_LABELS: Record<RowField, string> = {
  priority: "Priority",
  active: "Active",
  type: "Type",
  estimate: "Estimate",
  labels: "Labels",
  tokens: "Tokens",
  dueDate: "Due date",
  project: "Project",
  createdAt: "Created",
  updatedAt: "Edited",
};

const FIELD_SET = new Set<string>(CANONICAL_FIELD_ORDER);

/**
 * Fields shown by default per surface, reproducing today's hardwired output:
 * the list rail shows work-state chips (priority stays a leading editor, off the
 * rail), the board card shows priority and labels.
 */
const LIST_DEFAULT_VISIBLE: readonly RowField[] = [
  "active",
  "type",
  "estimate",
  "labels",
  "tokens",
  "dueDate",
  "project",
];
const BOARD_DEFAULT_VISIBLE: readonly RowField[] = ["priority", "labels"];

export type FieldSurface = "list" | "board";

export type FieldScope =
  | "all"
  | "active"
  | `project:${string}`
  | `board:${string}`;

export interface FieldEntry {
  field: RowField;
  visible: boolean;
}

export interface FieldDisplayConfig {
  /** Every canonical field exactly once, in render order. */
  fields: FieldEntry[];
  /** Render an enabled-but-empty field as a placeholder instead of collapsing. */
  showEmpty: boolean;
  /** Board only: show the task description's first lines on the card. */
  showDescription: boolean;
}

/** List surfaces reuse the list-filter scope strings; board scopes its own. */
export function listFieldScope(
  projectId: string | null,
  activeOnly: boolean,
): FieldScope {
  if (activeOnly) return "active";
  if (projectId !== null) return `project:${projectId}`;
  return "all";
}

export function boardFieldScope(projectId: string): FieldScope {
  return `board:${projectId}`;
}

export function surfaceOfScope(scope: FieldScope): FieldSurface {
  return scope.startsWith("board:") ? "board" : "list";
}

function defaultVisibleFor(surface: FieldSurface): readonly RowField[] {
  return surface === "board" ? BOARD_DEFAULT_VISIBLE : LIST_DEFAULT_VISIBLE;
}

export function defaultConfig(surface: FieldSurface): FieldDisplayConfig {
  const visible = new Set<string>(defaultVisibleFor(surface));
  return {
    fields: CANONICAL_FIELD_ORDER.map((field) => ({
      field,
      visible: visible.has(field),
    })),
    showEmpty: false,
    showDescription: false,
  };
}

/**
 * Build a config from a possibly-partial stored `fields` list: keep valid,
 * unique, in-order entries, then append any canonical field the list omits as
 * hidden. `fallbackVisible` decides an appended field's visibility — the surface
 * default when there is no stored list at all (fresh/migrated), hidden once the
 * user has a stored order (a field added later must not appear on its own).
 */
function reconcileFields(
  stored: unknown,
  fallbackVisible: (field: RowField) => boolean,
): FieldEntry[] {
  const seen = new Set<RowField>();
  const entries: FieldEntry[] = [];
  if (Array.isArray(stored)) {
    for (const raw of stored) {
      if (raw === null || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      const field = record.field;
      if (typeof field !== "string" || !FIELD_SET.has(field)) continue;
      const typed = field as RowField;
      if (seen.has(typed)) continue;
      seen.add(typed);
      entries.push({ field: typed, visible: record.visible === true });
    }
  }
  for (const field of CANONICAL_FIELD_ORDER) {
    if (seen.has(field)) continue;
    entries.push({ field, visible: fallbackVisible(field) });
  }
  return entries;
}

function sanitizeSurface(
  raw: unknown,
  surface: FieldSurface,
): FieldDisplayConfig {
  const record =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const hasStoredOrder = Array.isArray(record.fields);
  const surfaceDefault = new Set<string>(defaultVisibleFor(surface));
  const fields = reconcileFields(record.fields, (field) =>
    // With no stored order this is a fresh config → surface default; with a
    // stored order, an appended (newer) field stays hidden.
    hasStoredOrder ? false : surfaceDefault.has(field),
  );
  return {
    fields,
    showEmpty: record.showEmpty === true,
    showDescription: record.showDescription === true,
  };
}

interface ParsedDocument {
  /** Per-scope raw surface records (v2). */
  scopes: Record<string, unknown>;
  /** v1 global hidden list, migrated into list scopes on read. */
  legacyHidden: RowField[] | null;
  /** True when the stored document was written by a newer client. */
  isFutureVersion: boolean;
}

const EMPTY_DOCUMENT: ParsedDocument = {
  scopes: {},
  legacyHidden: null,
  isFutureVersion: false,
};

function sanitizeLegacyHidden(values: unknown): RowField[] {
  if (!Array.isArray(values)) return [];
  const hidden: RowField[] = [];
  const seen = new Set<RowField>();
  for (const value of values) {
    if (typeof value !== "string" || !FIELD_SET.has(value)) continue;
    const field = value as RowField;
    if (seen.has(field)) continue;
    seen.add(field);
    hidden.push(field);
  }
  return hidden;
}

function readStorage(): ParsedDocument {
  try {
    const raw = window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY);
    if (raw === null) return EMPTY_DOCUMENT;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return EMPTY_DOCUMENT;
    }
    const record = parsed as Record<string, unknown>;
    const version =
      typeof record.version === "number" && Number.isFinite(record.version)
        ? record.version
        : null;
    // v1 stored a single global `hidden` list with no scopes; carry it forward
    // as a migration seed for list scopes rather than discarding the choice.
    if (version === 1) {
      return {
        scopes: {},
        legacyHidden: sanitizeLegacyHidden(record.hidden),
        isFutureVersion: false,
      };
    }
    const scopes =
      record.scopes !== null &&
      typeof record.scopes === "object" &&
      !Array.isArray(record.scopes)
        ? (record.scopes as Record<string, unknown>)
        : {};
    return {
      scopes,
      legacyHidden: null,
      isFutureVersion: version !== null && version > ROW_FIELD_PREFERENCE_VERSION,
    };
  } catch {
    return EMPTY_DOCUMENT;
  }
}

/** A migrated list default: canonical order with the v1 hidden fields removed. */
function migratedListConfig(hidden: readonly RowField[]): FieldDisplayConfig {
  const hiddenSet = new Set<string>(hidden);
  const base = defaultConfig("list");
  return {
    ...base,
    fields: base.fields.map((entry) => ({
      field: entry.field,
      visible: entry.visible && !hiddenSet.has(entry.field),
    })),
  };
}

function resolveConfig(
  document: ParsedDocument,
  scope: FieldScope,
): FieldDisplayConfig {
  const surface = surfaceOfScope(scope);
  if (scope in document.scopes) {
    return sanitizeSurface(document.scopes[scope], surface);
  }
  if (surface === "list" && document.legacyHidden !== null) {
    return migratedListConfig(document.legacyHidden);
  }
  return defaultConfig(surface);
}

/** Read one scope's config from storage (no subscription); for init and tests. */
export function loadFieldDisplay(scope: FieldScope): FieldDisplayConfig {
  return resolveConfig(readStorage(), scope);
}

function serializeSurface(config: FieldDisplayConfig): unknown {
  return {
    fields: config.fields.map((entry) => ({
      field: entry.field,
      visible: entry.visible,
    })),
    showEmpty: config.showEmpty,
    showDescription: config.showDescription,
  };
}

let document: ParsedDocument = readStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ParsedDocument {
  return document;
}

/**
 * Persist a scope's config and refresh the in-memory document. Refuses to
 * overwrite storage written by a newer client so older builds cannot
 * down-convert a future document; the in-memory session still updates.
 */
function writeConfig(scope: FieldScope, config: FieldDisplayConfig): void {
  const nextScopes: Record<string, unknown> = {
    ...document.scopes,
    [scope]: serializeSurface(config),
  };
  // Reflect the change in-session even if persistence is refused/blocked.
  document = { ...document, legacyHidden: null, scopes: nextScopes };
  try {
    const existing = readStorage();
    if (existing.isFutureVersion) {
      emit();
      return;
    }
    // Merge onto whatever is on disk (concurrent same-version writers) but keep
    // our just-set scope authoritative.
    const merged: Record<string, unknown> = { ...existing.scopes, ...nextScopes };
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: ROW_FIELD_PREFERENCE_VERSION, scopes: merged }),
    );
    document = { scopes: merged, legacyHidden: null, isFutureVersion: false };
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
  }
  emit();
}

function updateConfig(
  scope: FieldScope,
  update: (config: FieldDisplayConfig) => FieldDisplayConfig,
): void {
  // Base each edit on what is actually persisted, not a possibly-stale
  // in-memory snapshot, so concurrent writers and test resets stay consistent.
  writeConfig(scope, update(resolveConfig(readStorage(), scope)));
}

/** Toggle one field's visibility for a scope; order is unchanged. */
export function toggleFieldVisible(scope: FieldScope, field: RowField): void {
  updateConfig(scope, (config) => ({
    ...config,
    fields: config.fields.map((entry) =>
      entry.field === field ? { ...entry, visible: !entry.visible } : entry,
    ),
  }));
}

/** Move the field at `from` to index `to`, shifting the rest (drag reorder). */
export function moveField(scope: FieldScope, from: number, to: number): void {
  updateConfig(scope, (config) => {
    const fields = [...config.fields];
    if (
      from < 0 ||
      from >= fields.length ||
      to < 0 ||
      to >= fields.length ||
      from === to
    ) {
      return config;
    }
    const [moved] = fields.splice(from, 1);
    fields.splice(to, 0, moved!);
    return { ...config, fields };
  });
}

export function setShowEmpty(scope: FieldScope, value: boolean): void {
  updateConfig(scope, (config) => ({ ...config, showEmpty: value }));
}

export function setShowDescription(scope: FieldScope, value: boolean): void {
  updateConfig(scope, (config) => ({ ...config, showDescription: value }));
}

/** Reset a scope back to its surface default. */
export function resetFieldDisplay(scope: FieldScope): void {
  writeConfig(scope, defaultConfig(surfaceOfScope(scope)));
}

/** Reactive config for one scope; re-renders subscribers on any change. */
export function useFieldDisplay(scope: FieldScope): FieldDisplayConfig {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => resolveConfig(snapshot, scope), [snapshot, scope]);
}
