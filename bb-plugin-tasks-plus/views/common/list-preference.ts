import { useMemo, useSyncExternalStore } from "react";
import {
  DATE_FIELDS,
  LIST_SORTS,
  NUMBER_FIELDS,
  SORT_FIELDS,
  TABLE_SORT_DIRECTIONS,
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  TEXT_FIELDS,
  VALUE_FILTER_FIELDS,
  type TaskEstimate,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "../../shared/enums.js";
import { isTaskId } from "../../shared/format.js";
import type { Range, ViewSort } from "../../shared/task-fields.js";
import {
  EMPTY_FILTERS,
  type ListFilterState,
} from "./filter-state.js";

/**
 * Client-local list filter/sort preferences. Stored in the browser profile so
 * one client (or user profile) does not rewrite another client connected to
 * the same bb server — same boundary as the Tasks sidebar preference.
 *
 * Preferences are scoped per list surface so All / Active / each project keep
 * independent restored and cleared state.
 */
export const LIST_PREFERENCE_STORAGE_KEY = "bb-tasks:list-preferences";
export const LIST_PREFERENCE_VERSION = 1 as const;

export type ListPreferenceScope =
  | "all"
  | "active"
  | "waiting"
  | `project:${string}`;

/**
 * Which cross-project surface a ListView renders — mutually exclusive with a
 * project scope, hence a sum rather than a second boolean flag alongside a
 * hypothetical `activeOnly`/`waitingOnly` pair (see code-standards-fp D4).
 * `null` means no special surface: All tasks, or a project's own list.
 */
export type ListScope = "active" | "waiting" | null;

export interface ListPreference {
  filters: ListFilterState;
  sort: ViewSort;
}

export const DEFAULT_LIST_PREFERENCE: ListPreference = {
  filters: EMPTY_FILTERS,
  sort: "manual",
};

interface StoredDocumentV1 {
  version: typeof LIST_PREFERENCE_VERSION;
  scopes: Record<string, unknown>;
}

export function listPreferenceScope(
  projectId: string | null,
  listScope: ListScope,
): ListPreferenceScope {
  if (listScope !== null) return listScope;
  if (projectId !== null) return `project:${projectId}`;
  return "all";
}

const STATUS_SET = new Set<string>(TASK_STATUSES);
const PRIORITY_SET = new Set<string>(TASK_PRIORITIES);
const TYPE_SET = new Set<string>(TASK_TYPES);
const ESTIMATE_SET = new Set<string>(TASK_ESTIMATES);
const SORT_SET = new Set<string>(LIST_SORTS);

/**
 * Keeps the valid, distinct strings of a stored list, in the order they were
 * written. One function behind every filter: statuses, priorities, types and
 * estimates pass their dictionary as `isValid`; names — labels, assignees,
 * epics — pass nothing, so a catalog that has not loaded yet cannot wipe the
 * choice.
 */
export function uniqueStrings<T extends string = string>(
  values: unknown,
  isValid?: (value: string) => value is T,
): T[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (name.length === 0 || seen.has(name)) continue;
    if (isValid && !isValid(name)) continue;
    seen.add(name);
    result.push(name as T);
  }
  return result;
}

/** A dictionary check that also narrows, so the caller needs no cast. */
const inSet =
  <T extends string>(set: ReadonlySet<string>) =>
  (value: string): value is T =>
    set.has(value);

const FIELD_SET = new Set<string>(SORT_FIELDS);
const DIRECTION_SET = new Set<string>(TABLE_SORT_DIRECTIONS);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A stored sort: a list sort as written before sorts had a direction, or a field and a direction. */
function sanitizeSort(value: unknown): ViewSort {
  if (typeof value === "string" && SORT_SET.has(value)) {
    return value as ViewSort;
  }
  if (isRecord(value) && FIELD_SET.has(String(value.column)) && DIRECTION_SET.has(String(value.direction))) {
    return { column: value.column, direction: value.direction } as ViewSort;
  }
  return DEFAULT_LIST_PREFERENCE.sort;
}

/**
 * One group of per-field filters, keeping the entries of known fields whose
 * value `read` accepts; absent when nothing survives, as the state keeps it.
 */
function sanitizeGroup<V>(
  raw: unknown,
  fields: readonly string[],
  read: (value: unknown) => V | null,
): Record<string, V> | undefined {
  if (!isRecord(raw)) return undefined;
  const kept = fields.flatMap((field) => {
    const value = read(raw[field]);
    return value === null ? [] : [[field, value] as const];
  });
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

const readPicked = (value: unknown): string[] | null => {
  const picked = uniqueStrings(value);
  return picked.length > 0 ? picked : null;
};

const readText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const readRange =
  <T,>(isBound: (bound: unknown) => bound is T) =>
  (value: unknown): Range<T> | null => {
    if (!isRecord(value) || typeof value.empty !== "boolean") return null;
    const { from = null, to = null, empty } = value;
    if ((from !== null && !isBound(from)) || (to !== null && !isBound(to))) return null;
    return from === null && to === null && !empty ? null : { from, to, empty };
  };

const isDay = (bound: unknown): bound is string => typeof bound === "string" && DAY.test(bound);
const isNumber = (bound: unknown): bound is number => typeof bound === "number" && Number.isFinite(bound);

/** The per-field filters a stored record carries, each group only when it filters something. */
function sanitizeFieldFilters(raw: Record<string, unknown>): Partial<ListFilterState> {
  const groups = {
    values: sanitizeGroup(raw.values, VALUE_FILTER_FIELDS, readPicked),
    texts: sanitizeGroup(raw.texts, TEXT_FIELDS, readText),
    dates: sanitizeGroup(raw.dates, DATE_FIELDS, readRange(isDay)),
    numbers: sanitizeGroup(raw.numbers, NUMBER_FIELDS, readRange(isNumber)),
  };
  return Object.fromEntries(Object.entries(groups).filter(([, group]) => group !== undefined));
}

export function sanitizeListPreference(raw: unknown): ListPreference {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      filters: { ...EMPTY_FILTERS },
      sort: DEFAULT_LIST_PREFERENCE.sort,
    };
  }
  const record = raw as Record<string, unknown>;
  const filtersRaw =
    record.filters !== undefined &&
    record.filters !== null &&
    typeof record.filters === "object" &&
    !Array.isArray(record.filters)
      ? (record.filters as Record<string, unknown>)
      : record;
  return {
    filters: {
      statuses: uniqueStrings(filtersRaw.statuses, inSet<TaskStatus>(STATUS_SET)),
      priorities: uniqueStrings(filtersRaw.priorities, inSet<TaskPriority>(PRIORITY_SET)),
      types: uniqueStrings(filtersRaw.types, inSet<TaskType>(TYPE_SET)),
      estimates: uniqueStrings(filtersRaw.estimates, inSet<TaskEstimate>(ESTIMATE_SET)),
      labelNames: uniqueStrings(filtersRaw.labelNames),
      assignees: uniqueStrings(filtersRaw.assignees),
      // Only a task id names a parent; the epic filter this took over is left behind.
      parents: uniqueStrings(filtersRaw.parents, (value): value is string => isTaskId(value)),
      ...sanitizeFieldFilters(filtersRaw),
    },
    sort: sanitizeSort(record.sort),
  };
}

interface ParsedStorage {
  /** Document version as stored, when a number. */
  version: number | null;
  scopes: Record<string, unknown>;
  /** True when version is greater than this build understands. */
  isFutureVersion: boolean;
}

function readStorage(): ParsedStorage | null {
  try {
    const raw = window.localStorage.getItem(LIST_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.scopes === null ||
      typeof record.scopes !== "object" ||
      Array.isArray(record.scopes)
    ) {
      return null;
    }
    const version =
      typeof record.version === "number" && Number.isFinite(record.version)
        ? record.version
        : null;
    const isFutureVersion =
      version !== null && version > LIST_PREFERENCE_VERSION;
    // Only v1 (or missing version with a scopes map from early experiments)
    // is a fully known shape. Future versions may still expose a scopes map
    // for best-effort reads of known fields.
    if (
      version !== null &&
      version < LIST_PREFERENCE_VERSION
    ) {
      // No older versions shipped; refuse rather than silently invent fields.
      return null;
    }
    return {
      version,
      scopes: record.scopes as Record<string, unknown>,
      isFutureVersion,
    };
  } catch {
    return null;
  }
}

/**
 * Choices the browser refused to store — storage disabled, or a document of a
 * newer client — kept for the session so the list still follows them. A
 * write that lands clears them: storage is the truth again.
 */
let unsaved: Readonly<Record<string, ListPreference>> = {};
let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getRevision = () => revision;

export function loadListPreference(scope: ListPreferenceScope): ListPreference {
  const kept = unsaved[scope];
  if (kept !== undefined) return kept;
  const document = readStorage();
  if (document === null) {
    return {
      filters: { ...EMPTY_FILTERS },
      sort: DEFAULT_LIST_PREFERENCE.sort,
    };
  }
  return sanitizeListPreference(document.scopes[scope]);
}

/**
 * Persist a preference for one scope and redraw every reader of it. Refuses
 * to overwrite storage written by a newer client (version > current) so older
 * builds cannot down-convert a future document. Concurrent same-version
 * writes merge scopes.
 */
export function storeListPreference(
  scope: ListPreferenceScope,
  preference: ListPreference,
): void {
  const sanitized = sanitizeListPreference(preference);
  unsaved = persist(scope, sanitized) ? {} : { ...unsaved, [scope]: sanitized };
  revision += 1;
  for (const listener of listeners) listener();
}

/** A scope's filters and sort, redrawn whenever any scope is stored. */
export function useListPreference(scope: ListPreferenceScope): ListPreference {
  const current = useSyncExternalStore(subscribe, getRevision, getRevision);
  return useMemo(() => loadListPreference(scope), [scope, current]);
}

/** Writes one scope into storage; false when the browser or a newer document refuses. */
function persist(scope: ListPreferenceScope, sanitized: ListPreference): boolean {
  try {
    const existing = readStorage();
    if (existing?.isFutureVersion) return false;
    const scopes = { ...(existing?.scopes ?? {}) };
    scopes[scope] = sanitized;
    const document: StoredDocumentV1 = {
      version: LIST_PREFERENCE_VERSION,
      scopes,
    };
    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify(document),
    );
    return true;
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
    return false;
  }
}
