// Type-only: keeps the frontend bundle clear of shared/contract.ts's runtime
// dependencies (zod, the server SDK). Same trick as client/data.ts.
import type { SavedView, SavedViewFilters, TableSettings } from "../../shared/contract.js";
import type { TaskLayout } from "../../shared/enums.js";
import type { ViewSort } from "../../shared/task-fields.js";
import {
  loadListPreference,
  storeListPreference,
  type ListPreferenceScope,
} from "./list-preference.js";
import {
  applyFieldDisplay,
  defaultConfig,
  listFieldScope,
  loadFieldDisplay,
  type FieldDisplayConfig,
  type FieldScope,
} from "./row-field-preference.js";
import {
  applyTableSettings,
  captureTableSettings,
  DEFAULT_TABLE_SETTINGS,
  sortFromListSort,
} from "../table/table-preference.js";

/**
 * The scopes a view can be saved from — exactly the scopes that have filters
 * and a sort. A board is deliberately not one of them: its Display menu only
 * orders columns. Spelling that in the type makes "save the board as a view"
 * unrepresentable instead of silently wrong.
 */
export type ListScopeString = ListPreferenceScope;

export function isListScope(scope: FieldScope): scope is ListScopeString {
  return !scope.startsWith("board:");
}

/**
 * Everything a saved view carries about the list it opens. The record in kv
 * adds an id, a version and a creation time; this is the part the client
 * takes off a list and puts back onto one. `table` is null for a view saved
 * before tables had their own settings, or one that never carried them —
 * `applyListState` then leaves the table it opens onto exactly as it was.
 */
export interface ListState {
  projectId: string | null;
  listScope: "active" | "waiting" | null;
  filters: SavedViewFilters;
  sort: ViewSort;
  fields: FieldDisplayConfig;
  table: TableSettings | null;
}

/**
 * What one header and one Display panel control: a screen's scope — a
 * cross-project surface or a project — drawn as a table or a board, with the
 * saved view open on it, if any. A board is no longer a project's privilege:
 * `scope` is the same string a list's preferences key off, so any screen can
 * open either layout.
 */
export type ViewTarget = { layout: TaskLayout; scope: ListScopeString; view: SavedView | null };

/** The surface a list scope string names, read back out of it. */
export function surfaceOf(scope: ListScopeString): Pick<ListState, "projectId" | "listScope"> {
  if (scope === "active" || scope === "waiting") {
    return { projectId: null, listScope: scope };
  }
  if (scope.startsWith("project:")) {
    return { projectId: scope.slice("project:".length), listScope: null };
  }
  return { projectId: null, listScope: null };
}

/**
 * Takes the whole state of one list — which list, its filters, its sort and
 * its columns. Filters and sort live in one store, columns in another; this
 * is the single place that knows a view is made of both.
 */
export function captureListState(scope: ListScopeString): ListState {
  const preference = loadListPreference(scope);
  return {
    ...surfaceOf(scope),
    filters: preference.filters,
    sort: preference.sort,
    fields: loadFieldDisplay(scope),
    table: captureTableSettings(scope),
  };
}

/**
 * A view's field config as it actually applies: a well-formed one always
 * lists every canonical field once; an empty one never came from
 * `captureListState` (`loadFieldDisplay` never returns it) — only from a
 * record saved before fields were tracked at all. Read as the surface
 * default instead of a config that would hide everything but the fields
 * shown before there were fields — `applyListState` and a view's own
 * "changed" comparison (views/board/toolbar.tsx) must agree on this, or a
 * view reads as still-changed right after it was just put back.
 */
export function effectiveViewFields(fields: FieldDisplayConfig): FieldDisplayConfig {
  return fields.fields.length > 0 ? fields : defaultConfig("list");
}

/**
 * A view's table settings as they actually apply. A view saved before tables
 * had settings of its own opens as the defaults sorted the way its list was —
 * never as whatever the screen's table was left in. `applyListState` and a
 * view's own "changed" comparison (views/board/toolbar.tsx) read it the same
 * way, or the view reads as changed the moment it opens.
 */
export function effectiveViewTable(state: Pick<ListState, "table" | "sort">): TableSettings {
  return state.table ?? { ...DEFAULT_TABLE_SETTINGS, sort: sortFromListSort(state.sort) };
}

/** Puts a view's state back onto the table it opens. */
export function applyListState(state: ListState): void {
  // Both stores key off the same string; `listFieldScope` builds it, and a
  // view never names a board, so the result is always a list scope.
  const scope = listFieldScope(state.projectId, state.listScope) as ListScopeString;
  storeListPreference(scope, {
    filters: { ...state.filters },
    sort: state.sort,
  });
  applyFieldDisplay(scope, effectiveViewFields(state.fields));
  applyTableSettings(scope, effectiveViewTable(state));
}
