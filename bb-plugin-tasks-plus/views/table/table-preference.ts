import { useMemo, useSyncExternalStore } from "react";
// Type-only: keeps the frontend bundle clear of contract.ts's runtime
// dependencies (zod, the server SDK) — the same trick board-preference.ts and
// list-preference.ts use for the types they store.
import type { TableSettings } from "../../shared/contract.js";
import { viewSortColumn, type ViewSort } from "../../shared/task-fields.js";
import { BOARD_GROUP_BYS, ROW_FIELDS, TABLE_SORT_DIRECTIONS } from "../../shared/enums.js";
import { loadListPreference, type ListPreferenceScope } from "../common/list-preference.js";
import { clampColumnWidth, type ColumnSort } from "./columns.js";

/**
 * Client-local table layout — sort, grouping, column widths, pinned columns
 * and collapsed groups — one per screen, in the browser profile like the
 * list's and the board's preferences, so one client does not rewrite
 * another. Modeled on views/common/list-preference.ts and
 * views/board/board-preference.ts.
 */
export const TABLE_PREFERENCE_STORAGE_KEY = "bb-tasks:table-preferences";
const TABLE_PREFERENCE_VERSION = 1 as const;

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  sort: null,
  groupBy: "status",
  widths: {},
  pinned: ["title"],
  collapsedGroups: [],
};

type TableColumnValue = ColumnSort["column"];
type SortDirectionValue = ColumnSort["direction"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const COLUMN_SET = new Set<string>(ROW_FIELDS);
const DIRECTION_SET = new Set<string>(TABLE_SORT_DIRECTIONS);
const GROUP_BY_SET = new Set<string>(BOARD_GROUP_BYS);

function sanitizeSort(raw: unknown): ColumnSort | null {
  if (!isRecord(raw)) return null;
  const { column, direction } = raw;
  if (typeof column !== "string" || !COLUMN_SET.has(column)) return null;
  if (typeof direction !== "string" || !DIRECTION_SET.has(direction)) return null;
  return {
    column: column as TableColumnValue,
    direction: direction as SortDirectionValue,
  };
}

function sanitizeGroupBy(raw: unknown): TableSettings["groupBy"] {
  return typeof raw === "string" && GROUP_BY_SET.has(raw)
    ? (raw as TableSettings["groupBy"])
    : DEFAULT_TABLE_SETTINGS.groupBy;
}

function sanitizeWidths(raw: unknown): TableSettings["widths"] {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([column, width]) =>
      COLUMN_SET.has(column) && typeof width === "number" && Number.isFinite(width)
        ? [[column, clampColumnWidth(width)]]
        : [],
    ),
  ) as TableSettings["widths"];
}

/** The valid, distinct column names of a stored list, in the order they were written. */
function sanitizeColumns(raw: unknown, fallback: readonly TableColumnValue[]): TableColumnValue[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<string>();
  const result: TableColumnValue[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !COLUMN_SET.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value as TableColumnValue);
  }
  return result;
}

/** Distinct group names of a stored list, in the order they were written — any string, not just columns. */
function sanitizeGroupNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function sanitizeTableSettings(raw: unknown): TableSettings {
  if (!isRecord(raw)) return DEFAULT_TABLE_SETTINGS;
  return {
    sort: sanitizeSort(raw.sort),
    groupBy: sanitizeGroupBy(raw.groupBy),
    widths: sanitizeWidths(raw.widths),
    pinned: sanitizeColumns(raw.pinned, DEFAULT_TABLE_SETTINGS.pinned as TableColumnValue[]),
    collapsedGroups: sanitizeGroupNames(raw.collapsedGroups),
  };
}

interface StoredDocument {
  scopes: Record<string, unknown>;
  /** Written by a newer client: read, never overwritten. */
  isFutureVersion: boolean;
}

function readDocument(): StoredDocument | null {
  try {
    const raw = window.localStorage.getItem(TABLE_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.scopes)) return null;
    const version = typeof parsed.version === "number" ? parsed.version : TABLE_PREFERENCE_VERSION;
    return { scopes: parsed.scopes, isFutureVersion: version > TABLE_PREFERENCE_VERSION };
  } catch {
    return null;
  }
}

/** Writes one screen into storage; false when the browser or a newer document refuses. */
function persist(scope: ListPreferenceScope, settings: TableSettings): boolean {
  try {
    const existing = readDocument();
    if (existing?.isFutureVersion) return false;
    const scopes = { ...(existing?.scopes ?? {}), [scope]: settings };
    window.localStorage.setItem(
      TABLE_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: TABLE_PREFERENCE_VERSION, scopes }),
    );
    return true;
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
    return false;
  }
}

/**
 * Settings storage refused, kept for this session so the table still
 * answers its own controls — as the list's preference does.
 */
let unsaved: Readonly<Record<string, TableSettings>> = {};

function store(scope: ListPreferenceScope, settings: TableSettings): void {
  unsaved = persist(scope, settings) ? {} : { ...unsaved, [scope]: settings };
}

let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getRevision = () => revision;

function emit(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/**
 * A list's sort as a table column sort, for a screen that has never had its
 * own table settings written: the table opens sorted the way the list was,
 * rather than unsorted. `manual` — the list's own default — has no column
 * equivalent.
 */
export const sortFromListSort = (sort: ViewSort): ColumnSort | null => viewSortColumn(sort);

/**
 * A screen's table settings. A screen with no table record of its own reads
 * as the defaults, except its sort — inherited from the list's own sort, so
 * a screen the list was sorted on opens the table sorted the same way.
 */
export function loadTableSettings(scope: ListPreferenceScope): TableSettings {
  const kept = unsaved[scope];
  if (kept !== undefined) return kept;
  const document = readDocument();
  const scopeRaw = document?.scopes[scope];
  if (scopeRaw === undefined) {
    return {
      ...DEFAULT_TABLE_SETTINGS,
      sort: sortFromListSort(loadListPreference(scope).sort),
    };
  }
  return sanitizeTableSettings(scopeRaw);
}

/** Merges a patch onto a screen's table settings and persists the result. */
export function setTableSettings(scope: ListPreferenceScope, patch: Partial<TableSettings>): void {
  const next = sanitizeTableSettings({ ...loadTableSettings(scope), ...patch });
  store(scope, next);
  emit();
}

/** Reactive table settings of one screen; re-renders on any screen's write. */
export function useTableSettings(scope: ListPreferenceScope): TableSettings {
  const seen = useSyncExternalStore(subscribe, getRevision, getRevision);
  return useMemo(() => loadTableSettings(scope), [scope, seen]);
}

/** A screen's table settings, as a saved view carries them. */
export function captureTableSettings(scope: ListPreferenceScope): TableSettings {
  return loadTableSettings(scope);
}

/** Puts a saved view's table settings onto a screen, replacing its own. */
export function applyTableSettings(scope: ListPreferenceScope, settings: TableSettings): void {
  store(scope, sanitizeTableSettings(settings));
  emit();
}
