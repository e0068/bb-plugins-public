// Layer: shared, pure. What an analytics tile can be set to: its chart types,
// windows, measures, figures and the settings each type reads. Constants and
// pure helpers only, no zod — the client imports this; the schemas over these
// lists live in contract.ts, which only the server reads by value.
import type { SavedViewFilters } from "./contract.js";
import { QUERY_FIELDS, type QueryField, type TableSortDirection } from "./enums.js";

/** How a tile draws. Gantt is `bars` whose length runs Start → Due. */
export const TILE_TYPES = ["columns", "bars", "line", "ring", "list", "table", "big"] as const;
export type TileType = (typeof TILE_TYPES)[number];

/** The units a tile's own period counts in: one column per minute, hour or day. */
export const WINDOW_UNITS = ["minute", "hour", "day"] as const;
export type WindowUnit = (typeof WINDOW_UNITS)[number];

/** The most columns a period may count: a day of minutes, a month of hours, a year of days. */
export const WINDOW_COUNT_MAX: Record<WindowUnit, number> = { minute: 1440, hour: 720, day: 366 };

/** Which columns a tile reads: the page's Day/Week/Month/All time, or the last `count` minutes, hours or days. */
export type TileWindow = "page" | { unit: WindowUnit; count: number };

/** The fixed periods tiles were saved with before, read as the units they meant. */
export const LEGACY_WINDOWS: Readonly<Record<string, TileWindow>> = {
  last24h: { unit: "hour", count: 24 },
  last30d: { unit: "day", count: 30 },
  last8w: { unit: "day", count: 56 },
};

/** What a cell counts — see docs/specs/analitika-model-plitki-i-agregaciya-po-lyubomu-polyu.md. */
export const Y_METRICS = ["count", "moves", "created", "closed", "createdClosed", "sum", "avg", "cycle", "accuracy"] as const;
export type YMetric = (typeof Y_METRICS)[number];

/** Measures that read a numeric field of the task. */
export const FIELD_METRICS = ["sum", "avg"] as const satisfies readonly YMetric[];

/** Measures whose series are fixed by the measure itself, so a breakdown does not split them. */
export const SERIES_METRICS = ["createdClosed"] as const satisfies readonly YMetric[];

/** The X axis: time — the window's columns — or any field the board filters by. */
export type TileAxis = "time" | QueryField;

/** The figures a «Big numbers» tile can show, in the order the figure strip had them. */
export const FIGURES = [
  "open",
  "in_progress",
  "in_review",
  "done",
  "created",
  "closed",
  "cycle",
  "planned",
  "actual",
  "budget",
  "cost",
  "limit",
] as const;
export type Figure = (typeof FIGURES)[number];

export const LEGEND_PLACES = ["right", "bottom", "hidden"] as const;
export type LegendPlace = (typeof LEGEND_PLACES)[number];

/** Bars measure their Y value, or run from a task's Start to its Due — the Gantt. */
export const BAR_LENGTHS = ["value", "range"] as const;
export type BarLength = (typeof BAR_LENGTHS)[number];

/** Sorts beyond the fields: by the Y value, and by how long a task stands in its status. */
export const TILE_SORT_KEYS = ["value", "timeInStatus"] as const;

/** Settings of a tile the panel edits and the server reads. */
export const TILE_SETTINGS = ["window", "x", "y", "breakdown", "switch", "filters", "sort", "limit", "bars", "figures", "legend", "axes", "grid", "trend", "contents"] as const;
export type TileSetting = (typeof TILE_SETTINGS)[number];

/** The settings each type reads; the panel shows only these, the answer ignores the rest. */
export const TILE_USES: Readonly<Record<TileType, readonly TileSetting[]>> = {
  columns: ["window", "x", "y", "breakdown", "switch", "filters", "sort", "limit", "legend", "axes", "grid", "trend", "contents"],
  bars: ["window", "x", "y", "breakdown", "switch", "filters", "sort", "limit", "bars", "legend", "axes", "grid", "contents"],
  line: ["window", "x", "y", "breakdown", "switch", "filters", "legend", "axes", "grid", "trend"],
  ring: ["window", "x", "y", "switch", "filters", "sort", "limit", "legend", "contents"],
  list: ["switch", "filters", "sort", "limit"],
  table: ["window", "x", "y", "breakdown", "switch", "filters", "sort", "limit"],
  big: ["window", "filters", "figures"],
};

/** Whether a tile of `type` reads `setting`. */
export const usesSetting = (type: TileType, setting: TileSetting): boolean => TILE_USES[type].includes(setting);

/** Settings bars read but a Gantt — bars running Start → Due — does not: it has no axis labels, grid or segments of its own. */
const GANTT_IGNORES: readonly TileSetting[] = ["axes", "grid", "contents"];

/** Whether a tile of `type`, its bars measuring `barLength`, reads `setting`. */
export const readsSetting = (type: TileType, barLength: BarLength, setting: TileSetting): boolean =>
  usesSetting(type, setting) && !(type === "bars" && barLength === "range" && GANTT_IGNORES.includes(setting));

/** Rows a list or a Gantt shows at most, and categories a chart keeps before the rest go to «Other». */
export const TILE_LIMIT = { min: 1, max: 200, list: 15, chart: 20 } as const;

/** Most task keys a cell lists for its segment; past it the list is cut. */
export const CELL_KEYS_MAX = 50;

/** Rows the table under a chart shows at first and per «Show more»: the bounds and where it starts. */
export const TILE_TABLE_ROWS = { min: 1, max: 500, start: 50 } as const;

/** Most tasks the table lists after «Show more» — what one answer carries at most. */
export const TILE_TABLE_SHOWN_MAX = 2000;

/** The table's row heights: the task table's 34 px, or 28 px. */
export const TILE_TABLE_HEIGHTS = ["regular", "compact"] as const;
export type TileTableHeight = (typeof TILE_TABLE_HEIGHTS)[number];

/** Fields that need what the analytics answer does not carry — threads, sub-tasks, files, other tasks' keys — stay out of the table. */
const TILE_TABLE_UNDRAWN: ReadonlySet<QueryField> = new Set(["active", "subtasks", "attachments", "worktree", "parent"]);

/** Fields the table under a chart can show, in the task table's order. */
export const TILE_TABLE_FIELDS: readonly QueryField[] = QUERY_FIELDS.filter((field) => !TILE_TABLE_UNDRAWN.has(field));

/** The columns a new table shows. */
export const TILE_TABLE_COLUMNS_START: readonly QueryField[] = ["key", "title", "status", "project"];

/** How the table under a chart is set: its columns in order, its sort, rows per segment and row height. */
export interface TileTable {
  columns: QueryField[];
  sort: { column: QueryField; direction: TableSortDirection } | null;
  rows: number;
  rowHeight: TileTableHeight;
}

/** A tile's table settings, the starting ones for a tile saved before it had a table. */
export const tileTable = (tile: { table?: TileTable }): TileTable =>
  tile.table ?? { columns: [...TILE_TABLE_COLUMNS_START], sort: null, rows: TILE_TABLE_ROWS.start, rowHeight: "regular" };

/** The chart's share of a tile's height while the tile lists its segments' tasks under it: the bounds the divider moves in, and where it starts. */
export const CONTENTS_SHARE = { min: 0.2, max: 0.8, start: 0.6 } as const;

/** Characters a tile's title holds at most. */
export const TILE_TITLE_MAX = 120;

/** Grid lines a chart draws at most each way; a finer step is coarsened to it. */
export const GRID_LINES_MAX = 50;

/** Series a breakdown keeps before the rest go to «Other». */
export const SERIES_LIMIT = 12;

/** The key of the bucket that gathers categories and series past the limit, and of a field's empty value. */
export const OTHER_KEY = "__other";
export const NONE_KEY = "__none";

/* ---------- the tile's filter: rows "field · operator · value" (tile-conditions.ts) ---------- */

export const CONDITION_OPS = ["eq", "ne", "gt", "lt"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** How an operator reads in the filter. */
export const CONDITION_OP_SIGN: Record<ConditionOp, string> = { eq: "=", ne: "≠", gt: ">", lt: "<" };

export const CONDITIONS_MAX = 50;
export const CONDITION_VALUE_MAX = 200;

export interface TileCondition {
  field: QueryField;
  op: ConditionOp;
  /** As typed or picked: a status id, a number, a day YYYY-MM-DD or a minute YYYY-MM-DDTHH:mm, a name, a piece of text. */
  value: string;
}

/**
 * A tile saved while its filter was the board's: the values picked in the
 * first lists become = rows; parents, texts and ranges have no row to become
 * and are dropped.
 */
export function conditionsFromFilters(filters: SavedViewFilters): TileCondition[] {
  const rows = (field: QueryField, values: readonly string[]) => values.map((value): TileCondition => ({ field, op: "eq", value }));
  return [
    ...rows("status", filters.statuses),
    ...rows("priority", filters.priorities),
    ...rows("type", filters.types),
    ...rows("estimate", filters.estimates),
    ...rows("labels", filters.labelNames),
    ...rows("assignee", filters.assignees),
  ];
}
