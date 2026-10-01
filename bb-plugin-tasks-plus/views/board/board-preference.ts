import { useMemo, useSyncExternalStore } from "react";
// Type-only: keeps the frontend bundle clear of contract.ts's runtime
// dependencies (zod, the server SDK).
import type { BoardGrouping, SavedView } from "../../shared/contract.js";
import {
  BOARD_GRID_COLUMN_COUNTS,
  BOARD_GROUP_BYS,
  BOARD_GROUP_PROPERTIES,
  type BoardGridColumns,
  type BoardGroupBy,
} from "../../shared/enums.js";
import { EMPTY_FILTERS } from "../common/filter-state.js";
import {
  sanitizeListPreference,
  uniqueStrings,
  type ListPreferenceScope,
} from "../common/list-preference.js";
import {
  applyFieldDisplay,
  boardFieldScope,
  loadFieldDisplay,
  type FieldDisplayConfig,
} from "../common/row-field-preference.js";
import { clampWidth, type BoardLayout } from "./grouping.js";
import { isRecord } from "./per-board-store.js";
import { scopeProjectId } from "./scope-data.js";

/**
 * Client-local board layouts — filters, sort and grouping — one per board,
 * in the browser profile like the list's preferences, so one client does not
 * rewrite another. A board is a project's own board or a saved view opened
 * on it; each keeps its own layout, so opening a view never overwrites the
 * project's board, and the view's draft is what Save and Reset compare.
 */
export const BOARD_PREFERENCE_STORAGE_KEY = "bb-tasks:board-preferences";
const BOARD_PREFERENCE_VERSION = 1;

/** A board's storage key; the same string keys its card fields. */
export type BoardKey = `board:${string}`;

export function boardKey(projectId: string, viewId: string | null): BoardKey {
  const projectBoard = boardFieldScope(projectId);
  return viewId === null ? projectBoard : `${projectBoard}#${viewId}`;
}

/**
 * A board's key for whichever screen it opens on: a project keeps its own
 * key (unchanged, so an existing draft is still found), while All tasks,
 * Active and Waiting each get one key of their own — as cross-project
 * screens they never shared a board layout before now.
 */
export function scopeBoardKey(scope: ListPreferenceScope, viewId: string | null): BoardKey {
  const projectId = scopeProjectId(scope);
  if (projectId !== null) return boardKey(projectId, viewId);
  const surfaceBoard: BoardKey = `board:@${scope}`;
  return viewId === null ? surfaceBoard : `${surfaceBoard}#${viewId}`;
}

export const DEFAULT_BOARD_LAYOUT: BoardLayout = {
  filters: EMPTY_FILTERS,
  sort: "manual",
  grouping: { groupBy: "status", columns: {}, hideEmpty: false },
};

const GROUP_BY_SET = new Set<string>(BOARD_GROUP_BYS);

function sanitizeWidths(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, width]) =>
      typeof width === "number" && Number.isFinite(width) ? [[key, clampWidth(width)]] : [],
    ),
  );
}

const GRID_COLUMN_SET = new Set<unknown>(BOARD_GRID_COLUMN_COUNTS);

/** A fixed count stays; auto and anything else is left out, as a grouping saved before the choice. */
function sanitizeGridColumns(raw: unknown): Pick<BoardGrouping, "gridColumns"> {
  return GRID_COLUMN_SET.has(raw) ? { gridColumns: raw as Exclude<BoardGridColumns, "auto"> } : {};
}

function sanitizeGrouping(raw: unknown): BoardGrouping {
  const fallback = DEFAULT_BOARD_LAYOUT.grouping;
  if (!isRecord(raw)) return fallback;
  const columnsRaw = isRecord(raw.columns) ? raw.columns : {};
  const columns = Object.fromEntries(
    BOARD_GROUP_PROPERTIES.flatMap((property) => {
      const settings = columnsRaw[property];
      if (!isRecord(settings)) return [];
      return [
        [
          property,
          {
            order: uniqueStrings(settings.order),
            hidden: uniqueStrings(settings.hidden),
            widths: sanitizeWidths(settings.widths),
          },
        ],
      ];
    }),
  );
  return {
    groupBy:
      typeof raw.groupBy === "string" && GROUP_BY_SET.has(raw.groupBy)
        ? (raw.groupBy as BoardGroupBy)
        : fallback.groupBy,
    columns,
    hideEmpty: raw.hideEmpty === true,
    ...sanitizeGridColumns(raw.gridColumns),
  };
}

function sanitizeLayout(raw: unknown): BoardLayout {
  const { filters, sort } = sanitizeListPreference(
    isRecord(raw) ? { filters: raw.filters ?? {}, sort: raw.sort } : null,
  );
  return { filters, sort, grouping: sanitizeGrouping(isRecord(raw) ? raw.grouping : null) };
}

interface StoredDocument {
  scopes: Record<string, unknown>;
  isFutureVersion: boolean;
}

function readStorage(): StoredDocument | null {
  try {
    const raw = window.localStorage.getItem(BOARD_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.scopes)) return null;
    return {
      scopes: parsed.scopes,
      isFutureVersion:
        typeof parsed.version === "number" && parsed.version > BOARD_PREFERENCE_VERSION,
    };
  } catch {
    return null;
  }
}

/**
 * Layouts written this session while a newer client owns the stored
 * document: storage is left alone, and the board still follows the clicks.
 */
const unsaved = new Map<string, BoardLayout>();
let generation = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getGeneration = () => generation;

function emit(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

/** Read one board's layout, without a subscription. */
export function loadBoardLayout(key: BoardKey): BoardLayout {
  const stored = readStorage();
  const pending = stored?.isFutureVersion ? unsaved.get(key) : undefined;
  if (pending) return pending;
  const scope = stored?.scopes[key];
  return scope === undefined ? DEFAULT_BOARD_LAYOUT : sanitizeLayout(scope);
}

/** Whether this board has a layout of its own yet — a view opened before. */
export function hasBoardDraft(key: BoardKey): boolean {
  const stored = readStorage();
  return stored?.scopes[key] !== undefined || (stored?.isFutureVersion === true && unsaved.has(key));
}

export function setBoardLayout(key: BoardKey, layout: BoardLayout): void {
  const next = sanitizeLayout(layout);
  const existing = readStorage();
  if (existing?.isFutureVersion) {
    unsaved.set(key, next);
    emit();
    return;
  }
  try {
    window.localStorage.setItem(
      BOARD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: BOARD_PREFERENCE_VERSION,
        scopes: { ...(existing?.scopes ?? {}), [key]: next },
      }),
    );
  } catch {
    // Persistence is best-effort, as for the list's preferences.
  }
  emit();
}

/** Reactive layout of one board; re-renders on any board layout change. */
export function useBoardLayout(key: BoardKey): BoardLayout {
  const seen = useSyncExternalStore(subscribe, getGeneration, getGeneration);
  // `seen` is the change counter: a new value means storage may hold a new layout.
  return useMemo(() => loadBoardLayout(key), [key, seen]);
}

/** A board's whole state as a view carries it: layout plus card fields. */
export interface BoardState {
  filters: BoardLayout["filters"];
  sort: BoardLayout["sort"];
  board: BoardGrouping;
  fields: FieldDisplayConfig;
}

export function captureBoardState(key: BoardKey): BoardState {
  const layout = loadBoardLayout(key);
  return {
    filters: layout.filters,
    sort: layout.sort,
    board: layout.grouping,
    fields: loadFieldDisplay(key),
  };
}

/** Puts a board view's state onto a board — its layout and its card fields. */
export function applyBoardState(
  key: BoardKey,
  view: Pick<SavedView, "filters" | "sort" | "board" | "fields">,
): void {
  setBoardLayout(key, {
    filters: view.filters,
    sort: view.sort,
    grouping: view.board ?? DEFAULT_BOARD_LAYOUT.grouping,
  });
  applyFieldDisplay(key, view.fields);
}
