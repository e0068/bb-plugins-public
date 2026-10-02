import type { SavedViewFilters } from "../../shared/contract.js";
import type { TaskLayout } from "../../shared/enums.js";
import { viewSortColumn, type ColumnSort, type ViewSort } from "../../shared/task-fields.js";
import { loadListPreference, storeListPreference } from "../common/list-preference.js";
import type { ListScopeString } from "../common/view-state.js";
import { loadTableSettings, setTableSettings } from "../table/table-preference.js";
import { loadBoardLayout, scopeBoardKey, setBoardLayout, type BoardKey } from "./board-preference.js";

/**
 * What the owner narrowed a screen down to: its filters and its sort. A
 * table and a board keep them in stores of their own — the table its sort
 * among its column settings, the board beside its grouping — so switching
 * Table ↔ Board carries this pair across, and nothing else: the board's
 * grouping and the table's columns stay each layout's own.
 */
interface Narrowing {
  filters: SavedViewFilters;
  sort: ColumnSort | null;
}

const sameSort = (a: ColumnSort | null, b: ColumnSort | null): boolean =>
  a === b || (a !== null && b !== null && a.column === b.column && a.direction === b.direction);

/**
 * The board's stored sort for a carried one. A sort the board already reads
 * the same way stays as written, so a view saved with an old list sort does
 * not read as changed after a round trip.
 */
const boardSortFor = (current: ViewSort, carried: ColumnSort | null): ViewSort =>
  sameSort(viewSortColumn(current), carried) ? current : carried ?? "manual";

// Anything but a board reads as a table, as everywhere a layout is drawn.
function narrowingOf(scope: ListScopeString, board: BoardKey, layout: TaskLayout): Narrowing {
  if (layout !== "board") return { filters: loadListPreference(scope).filters, sort: loadTableSettings(scope).sort };
  const { filters, sort } = loadBoardLayout(board);
  return { filters, sort: viewSortColumn(sort) };
}

function putNarrowing(scope: ListScopeString, board: BoardKey, layout: TaskLayout, { filters, sort }: Narrowing): void {
  if (layout !== "board") {
    storeListPreference(scope, { ...loadListPreference(scope), filters });
    setTableSettings(scope, { sort });
    return;
  }
  const current = loadBoardLayout(board);
  setBoardLayout(board, { ...current, filters, sort: boardSortFor(current.sort, sort) });
}

/**
 * Carries a screen's filters and sort from the layout it leaves onto the one
 * it opens — a screen's own board, or a saved view's (`viewId`).
 */
export function carryNarrowing(scope: ListScopeString, viewId: string | null, from: TaskLayout, to: TaskLayout): void {
  if (from === to) return;
  const board = scopeBoardKey(scope, viewId);
  putNarrowing(scope, board, to, narrowingOf(scope, board, from));
}
