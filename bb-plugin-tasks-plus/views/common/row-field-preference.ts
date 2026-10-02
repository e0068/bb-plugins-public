import { useMemo } from "react";
import { useSyncExternalStore } from "react";
import { BOARD_ONLY_FIELDS, ROW_FIELDS, SUBTASK_SCOPES, type SubtaskScope, type TaskOpening } from "../../shared/enums.js";
import type { RowField as SharedRowField } from "../../shared/enums.js";
// Type-only: erased at compile time, so this never pulls zod or the server
// SDK (shared/contract.ts's runtime dependencies) into the frontend bundle.
// Same trick as client/data.ts's `TasksRpcContract`/`Task` imports.
import type { FieldDisplayConfig as ContractFieldDisplayConfig } from "../../shared/contract.js";
import type { ListScope } from "./list-preference.js";

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
 * provider, mirroring `client/refresh.tsx`.
 */
export const ROW_FIELD_PREFERENCE_STORAGE_KEY = "bb-tasks:row-field-preferences";
export const ROW_FIELD_PREFERENCE_VERSION = 2 as const;

// The field dictionary itself lives in shared/enums.ts, not here: a saved view
// is validated against it on the server too, so the set of field names is
// shared client/server knowledge, not a detail private to this view. Re-export
// under the names this module has always used so existing importers (row.tsx,
// board/index.tsx, field-plan.ts, …) need no changes.
export type RowField = SharedRowField;

/**
 * Canonical field order. A surface's default order is this list; stored configs
 * keep their own order and gain any field added here later, appended hidden so a
 * new field never surfaces itself on existing clients.
 */
export const CANONICAL_FIELD_ORDER: readonly RowField[] = ROW_FIELDS;

export const ROW_FIELD_LABELS: Record<RowField, string> = {
  parent: "Parent",
  title: "Title",
  description: "Description",
  key: "Key",
  priority: "Priority",
  status: "Status",
  slug: "Slug",
  active: "Active",
  assignee: "Assignee",
  flow: "Flow",
  type: "Type",
  estimate: "Estimate",
  labels: "Labels",
  subtasks: "Sub-tasks",
  attachments: "Attachments",
  worktree: "Worktree",
  takenBy: "Taken by",
  subtaskList: "Sub-task list",
  subtaskStats: "Sub-task stats",
  burndown: "Burndown",
  gantt: "Sub-task Gantt",
  plannedMinutes: "Planned Time",
  actualMinutes: "Actual Time",
  budget: "Budget",
  budgetLimit: "Limit",
  cost: "Cost",
  dueDate: "Due date",
  startDate: "Start date",
  project: "Project",
  createdAt: "Created",
  updatedAt: "Edited",
};

const BOARD_ONLY = new Set<string>(BOARD_ONLY_FIELDS);

/** The fields a surface offers, in canonical order. */
export const surfaceFieldOrder = (surface: FieldSurface): readonly RowField[] =>
  surface === "board" ? CANONICAL_FIELD_ORDER : CANONICAL_FIELD_ORDER.filter((field) => !BOARD_ONLY.has(field));

/**
 * Fields shown by default per surface, reproducing today's hardwired output:
 * the list rail shows work-state chips (priority stays a leading editor, off the
 * rail), the board card shows priority and labels.
 */
const LIST_DEFAULT_VISIBLE: readonly RowField[] = [
  "key",
  "active",
  "assignee",
  "flow",
  "type",
  "estimate",
  "labels",
  "plannedMinutes",
  "actualMinutes",
  "budget",
  "budgetLimit",
  "cost",
  "dueDate",
  "startDate",
  "project",
];
const BOARD_DEFAULT_VISIBLE: readonly RowField[] = [
  "parent",
  "title",
  "key",
  "priority",
  "active",
  "labels",
  "subtasks",
  "attachments",
  "worktree",
];

/**
 * Fields the surface drew before they were fields: a stored config that does
 * not list one yet gets it visible, so the card keeps what it always showed.
 */
const ALWAYS_DRAWN_BEFORE: Record<FieldSurface, ReadonlySet<RowField>> = {
  list: new Set(["key"]),
  board: new Set(["key", "subtasks"]),
};

export type FieldSurface = "list" | "board";

export type FieldScope =
  | "all"
  | "active"
  | "waiting"
  | `project:${string}`
  | `board:${string}`;

// The config travels to the database over RPC and is validated there against
// `shared/contract.ts`'s `fieldDisplayConfigSchema`, so its shape is shared
// client/server knowledge, not a view-local detail; this is a re-export under
// the old name for today's importers (field-plan.ts, row.tsx, board/index.tsx).
export type FieldDisplayConfig = ContractFieldDisplayConfig;
export type FieldEntry = FieldDisplayConfig["fields"][number];

/** List surfaces reuse the list-filter scope strings; board scopes its own. */
export function listFieldScope(
  projectId: string | null,
  listScope: ListScope,
): FieldScope {
  if (listScope !== null) return listScope;
  if (projectId !== null) return `project:${projectId}`;
  return "all";
}

export function boardFieldScope(projectId: string): `board:${string}` {
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
    fields: surfaceFieldOrder(surface).map((field) => ({
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
  surface: FieldSurface,
  fallbackVisible: (field: RowField) => boolean,
): FieldEntry[] {
  const offered = new Set<string>(surfaceFieldOrder(surface));
  const seen = new Set<RowField>();
  const entries: FieldEntry[] = [];
  if (Array.isArray(stored)) {
    for (const raw of stored) {
      if (raw === null || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      const field = record.field;
      if (typeof field !== "string" || !offered.has(field)) continue;
      const typed = field as RowField;
      if (seen.has(typed)) continue;
      seen.add(typed);
      entries.push({ field: typed, visible: record.visible === true });
    }
  }
  for (const field of surfaceFieldOrder(surface)) {
    if (seen.has(field)) continue;
    entries.push({ field, visible: fallbackVisible(field) });
  }
  return entries;
}

/** Whether a stored field list names `field`. */
const lists = (stored: unknown, field: RowField): boolean =>
  Array.isArray(stored) &&
  stored.some((raw) => raw !== null && typeof raw === "object" && (raw as Record<string, unknown>).field === field);

/** Whether the description shows — on the board card, or as a table column: the `description` field is visible. */
const descriptionShown = (fields: readonly FieldEntry[]): boolean =>
  fields.some((entry) => entry.field === "description" && entry.visible);

/**
 * Description was a separate on/off flag of the board card before it became
 * a field. A stored board order that does not list it gets it at the head —
 * where it always stood — on or off as the flag had it. The table offered no
 * description then, so a list order gains it the way any newer field comes:
 * appended, hidden.
 */
function placeUnlistedDescription(
  stored: unknown,
  fields: readonly FieldEntry[],
  wasShown: boolean,
): FieldEntry[] {
  if (lists(stored, "description")) return [...fields];
  return [{ field: "description", visible: wasShown }, ...fields.filter((entry) => entry.field !== "description")];
}

/** The card's title: always drawn, so its entry only places it. */
const TITLE: FieldEntry = { field: "title", visible: true };

/** What the card drew above its title, left to right, before these were fields. */
const TOP_LINE: readonly RowField[] = ["slug", "active", "parent", "worktree"];

/**
 * Where the title stands among a board's fields. A stored order that lists it
 * keeps it where it is, shown. One that does not was saved before the card
 * was all fields: its top line — the slug as it was, the working agents, the
 * parent and the worktree mark — goes back above the title, and the
 * paperclip back to the end, so the card looks as it did.
 */
function placeTitle(stored: unknown, fields: readonly FieldEntry[]): FieldEntry[] {
  if (!Array.isArray(stored) || lists(stored, "title")) {
    return fields.map((entry) => (entry.field === "title" ? TITLE : entry));
  }
  const slugShown = fields.some((entry) => entry.field === "slug" && entry.visible);
  const topLine = TOP_LINE.map((field) => ({ field, visible: field === "slug" ? slugShown : true }));
  const moved = new Set<RowField>([...TOP_LINE, "title", "attachments"]);
  return [...topLine, TITLE, ...fields.filter((entry) => !moved.has(entry.field)), { field: "attachments", visible: true }];
}

/** A click opening tasks beside the board stays; "main" and anything else is left out, as a config saved before the choice. */
function sanitizeTaskOpening(raw: unknown): Pick<FieldDisplayConfig, "taskOpening"> {
  return raw === "side-panel" ? { taskOpening: "side-panel" } : {};
}

/** Where a click on a task opens it for this scope; a config saved before the choice opens it in the main container. */
export const taskOpeningOf = (config: FieldDisplayConfig): TaskOpening => config.taskOpening ?? "main";

const NARROWED_SUBTASK_SCOPES = new Set<unknown>(SUBTASK_SCOPES.filter((scope) => scope !== "all"));

/** A narrowed scope stays; "all" and anything else is left out, as a config saved before the choice. */
function sanitizeSubtaskScope(raw: unknown): Pick<FieldDisplayConfig, "subtaskScope"> {
  return NARROWED_SUBTASK_SCOPES.has(raw) ? { subtaskScope: raw as SubtaskScope } : {};
}

/** Which sub-tasks a board card lists; a config saved before the choice lists them all. */
export const subtaskScopeOf = (config: FieldDisplayConfig): SubtaskScope => config.subtaskScope ?? "all";

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
  const reconciled = reconcileFields(record.fields, surface, (field) =>
    // With no stored order this is a fresh config → surface default; with a
    // stored order, an appended (newer) field stays hidden — unless the
    // surface drew it before it was a field.
    hasStoredOrder ? ALWAYS_DRAWN_BEFORE[surface].has(field) : surfaceDefault.has(field),
  );
  const fields =
    surface === "board"
      ? placeTitle(record.fields, placeUnlistedDescription(record.fields, reconciled, record.showDescription === true))
      : reconciled;
  return {
    fields,
    showEmpty: record.showEmpty === true,
    showDescription: descriptionShown(fields),
    ...sanitizeSubtaskScope(record.subtaskScope),
    ...sanitizeTaskOpening(record.taskOpening),
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
    if (typeof value !== "string" || !CANONICAL_FIELD_ORDER.includes(value as RowField)) continue;
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
    showDescription: descriptionShown(config.fields),
    ...sanitizeSubtaskScope(config.subtaskScope),
    ...sanitizeTaskOpening(config.taskOpening),
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

/** Toggle one field's visibility for a scope; order is unchanged. The title is always shown. */
export function toggleFieldVisible(scope: FieldScope, field: RowField): void {
  if (field === "title") return;
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

/** Show or hide the card's description — the `description` field — keeping its place in the order. */
export function setShowDescription(scope: FieldScope, value: boolean): void {
  updateConfig(scope, (config) => ({
    ...config,
    fields: config.fields.map((entry) =>
      entry.field === "description" ? { ...entry, visible: value } : entry,
    ),
  }));
}

export function setTaskOpening(scope: FieldScope, value: TaskOpening): void {
  updateConfig(scope, (config) => ({ ...config, taskOpening: value }));
}

export function setSubtaskScope(scope: FieldScope, value: SubtaskScope): void {
  updateConfig(scope, (config) => ({ ...config, subtaskScope: value }));
}

/** Reset a scope back to its surface default. */
export function resetFieldDisplay(scope: FieldScope): void {
  writeConfig(scope, defaultConfig(surfaceOfScope(scope)));
}

/**
 * Apply a whole config to a scope (saved view). Runs it through the same
 * sanitizer as any stored document: a view saved by an older client predates
 * fields added since, so they must be appended hidden rather than missing,
 * and any field the config no longer recognizes must be dropped rather than
 * stored verbatim. `sanitizeSurface` takes `unknown` and reads only the keys
 * it knows, so a malformed `config` (missing `fields`, extra junk) is cleaned
 * rather than thrown on — unlike `serializeSurface`, which assumes a
 * well-formed config and was dropped from this path for that reason.
 */
export function applyFieldDisplay(
  scope: FieldScope,
  config: FieldDisplayConfig,
): void {
  writeConfig(scope, sanitizeSurface(config, surfaceOfScope(scope)));
}

/**
 * A config as a scope would hold it once applied — what `applyFieldDisplay`
 * stores. A saved view is compared with the board it opened on through this,
 * so a view saved before a field existed does not read as changed.
 */
export function normalizeFieldDisplay(
  scope: FieldScope,
  config: FieldDisplayConfig,
): FieldDisplayConfig {
  return sanitizeSurface(config, surfaceOfScope(scope));
}

/** Reactive config for one scope; re-renders subscribers on any change. */
export function useFieldDisplay(scope: FieldScope): FieldDisplayConfig {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => resolveConfig(snapshot, scope), [snapshot, scope]);
}
