// Type-only: keeps the frontend bundle clear of contract.ts's runtime
// dependencies (zod, the server SDK) — the same trick row-field-preference.ts
// and board/grouping.ts use for Task/Label.
import type { Task } from "../../shared/contract.js";
import { isQueryField, TABLE_COLUMN_WIDTH, type TableSortDirection } from "../../shared/enums.js";
import { compareByField, factsOf, type ColumnSort, type TaskFacts } from "../../shared/task-fields.js";
import { surfaceFieldOrder, type RowField } from "../common/row-field-preference.js";

/**
 * The pure core of the table's column layout and its per-column sort: which
 * columns the table draws, in what order, how wide, and how a column's
 * values compare. No storage, no DOM — the table view and its toolbar feed
 * this from stored preferences and act on its answer.
 */

/** A table column is any row field; the table's visible set is a subset (see `TABLE_COLUMNS`). */
export type TableColumn = RowField;

export type SortDirection = TableSortDirection;

export type { ColumnSort };

/** What a column's comparator needs beyond the task fields themselves — whichever facts the table knows. */
export type SortContext = Partial<TaskFacts>;

/** The table's fields, in canonical order — the list surface's field set. */
export const TABLE_COLUMNS: readonly TableColumn[] = surfaceFieldOrder("list");

/** A column's starting width, px: the title and description read wider than the rest. */
export function defaultColumnWidth(column: TableColumn): number {
  if (column === "title") return 360;
  if (column === "description") return 280;
  return 140;
}

/** A dragged width held inside the allowed range, in whole pixels. */
export function clampColumnWidth(width: number): number {
  return Math.round(Math.min(TABLE_COLUMN_WIDTH.max, Math.max(TABLE_COLUMN_WIDTH.min, width)));
}

/**
 * The columns the table draws: the visible fields in their order, pinned
 * ones leading in their own order. The title is always drawn, even when the
 * fields list hides it or omits it outright (the list surface's field set
 * does not carry the title as a toggle).
 */
export function orderedColumns(
  fields: readonly { field: RowField; visible: boolean }[],
  pinned: readonly TableColumn[],
): TableColumn[] {
  const hasTitle = fields.some((entry) => entry.field === "title");
  const entries = hasTitle
    ? fields.map((entry) => (entry.field === "title" ? { ...entry, visible: true } : entry))
    : [{ field: "title" as TableColumn, visible: true }, ...fields];
  const visibleOrder = entries.filter((entry) => entry.visible).map((entry) => entry.field);
  const visible = new Set(visibleOrder);
  const pinnedLeading = [...new Set(pinned)].filter((column) => visible.has(column));
  const pinnedSet = new Set(pinnedLeading);
  const rest = visibleOrder.filter((column) => !pinnedSet.has(column));
  return [...pinnedLeading, ...rest];
}

/**
 * Each pinned column's offset from the left edge — the running sum of the
 * widths of the pinned columns before it — and the last pinned column, whose
 * right edge draws the pinned divider.
 */
export function pinOffsets(
  columns: readonly TableColumn[],
  pinned: readonly TableColumn[],
  widths: Partial<Record<TableColumn, number>>,
): { offsets: Partial<Record<TableColumn, number>>; edge: TableColumn | null } {
  const pinnedSet = new Set(pinned);
  const pinnedInOrder = columns.filter((column) => pinnedSet.has(column));
  const offsets = pinnedInOrder.reduce<{ offsets: Partial<Record<TableColumn, number>>; running: number }>(
    (acc, column) => ({
      offsets: { ...acc.offsets, [column]: acc.running },
      running: acc.running + (widths[column] ?? defaultColumnWidth(column)),
    }),
    { offsets: {}, running: 0 },
  ).offsets;
  const edge = pinnedInOrder.length > 0 ? pinnedInOrder[pinnedInOrder.length - 1]! : null;
  return { offsets, edge };
}

/**
 * The columns and pins after dragging `from` to sit at `toIndex` among the
 * columns without it. Dropping left of the pinned columns (not counting
 * `from` itself) pins it; dropping at or past that edge unpins it. The pin
 * set keeps the columns' left-to-right order.
 */
export function moveColumn(
  columns: readonly TableColumn[],
  pinned: readonly TableColumn[],
  from: TableColumn,
  toIndex: number,
): { columns: TableColumn[]; pinned: TableColumn[] } {
  const withoutFrom = columns.filter((column) => column !== from);
  const index = Math.min(Math.max(toIndex, 0), withoutFrom.length);
  const newColumns = [...withoutFrom.slice(0, index), from, ...withoutFrom.slice(index)];
  // Only pins on screen mark the zone's edge; a pinned column that is hidden
  // keeps its pin for when it comes back.
  const shownPinned = pinned.filter((column) => column !== from && columns.includes(column));
  const hiddenPinned = pinned.filter((column) => !columns.includes(column));
  const pinnedSet = new Set(shownPinned);
  if (index < shownPinned.length) pinnedSet.add(from);
  const newPinned = [...newColumns.filter((column) => pinnedSet.has(column)), ...hiddenPinned];
  return { columns: newColumns, pinned: newPinned };
}

/**
 * The side of the header at `toIndex` a column dragged from `fromIndex`
 * lands against under {@link moveColumn} — where the drop line draws; `null`
 * when it is dropped back onto itself.
 */
export function dropEdge(fromIndex: number, toIndex: number): "before" | "after" | null {
  if (toIndex === fromIndex) return null;
  return toIndex < fromIndex ? "before" : "after";
}

/** Whether a column offers a sort — every field but the card's widgets, which hold no value of their own. */
export const sortableColumn = (column: TableColumn): boolean => isQueryField(column);

/** A comparator over tasks for one column and direction; empty values sort last both ways (shared/task-fields.ts). */
export const compareByColumn = (sort: ColumnSort, context: SortContext): ((a: Task, b: Task) => number) =>
  compareByField(sort, factsOf(context));
