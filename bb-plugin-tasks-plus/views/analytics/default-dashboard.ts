// Pure model of the analytics screen: the tiles and rows it opens with before
// the owner changes anything, the page filter, and the columns each D/W/M cut
// and each tile window is drawn in. No React — AnalyticsDashboard.tsx renders
// this. Columns are local-calendar (see closed-model.ts), so the client
// computes them.
import { WINDOWS, type Window } from "@bb-plugins/analytics-viz/core/time-window";
import { weekBreaks, weekEdgesSince, type WeekBreak } from "@bb-plugins/analytics-viz/core/weeks";
import { TILE_TITLE_MAX, type TileWindow } from "../../shared/analytics-tile.js";
import type { Dashboard, Tile } from "../../shared/contract.js";
import type { SavedViewFilters } from "../../shared/contract.js";
import type { TileCondition } from "../../shared/tile-conditions.js";
import { EMPTY_FILTERS } from "../common/filter-state.js";
import { OPEN_STATUSES, type TaskStatus } from "../../shared/enums.js";
import { dayEdges, hourEdges, unitEdges } from "./closed-model";

/** The cuts of the screen: the rolling D/W/M every analytics surface offers, then the whole history. */
export const ANALYTICS_WINDOWS = [...WINDOWS, "all"] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

/** What the screen is narrowed to: a cut and the filters of the topbar, the same as a list's. */
export interface AnalyticsFilter {
  window: AnalyticsWindow;
  filters: SavedViewFilters;
}

export const DEFAULT_FILTER: AnalyticsFilter = { window: "week", filters: EMPTY_FILTERS };

/** What a tile is asked over: the projects the Project filter picks — none, all — and every filter of the bar. */
export interface TileScope {
  projectIds: string[];
  filters: SavedViewFilters;
}

export const tileScope = (filter: AnalyticsFilter): TileScope => ({ projectIds: [...(filter.filters.values?.project ?? [])], filters: filter.filters });

const WEEK_DAYS = 7;

/**
 * Columns of the series charts for a cut: hours for the day, local days for
 * the week and the month, weeks for all time — from the week of `firstMs`,
 * the first task; without one, the current week alone.
 */
export function windowEdges(window: AnalyticsWindow, nowMs: number, firstMs: number = nowMs): number[] {
  switch (window) {
    case "day":
      return hourEdges(nowMs);
    case "week":
      return dayEdges(nowMs).slice(-(WEEK_DAYS + 1));
    case "month":
      return dayEdges(nowMs);
    case "all":
      return weekEdgesSince(firstMs, nowMs);
  }
}

/** Where a cut's charts mark a new week: on day columns only — an hour is too fine, a week column is a week already. */
export function weekBreaksOf(window: AnalyticsWindow, edges: readonly number[]): WeekBreak[] {
  switch (window) {
    case "day":
    case "all":
      return [];
    case "week":
    case "month":
      return weekBreaks(edges.slice(0, -1));
  }
}

/** Days one column of a cut spans — what turns a per-column pace into a per-day one. */
export function columnDays(window: AnalyticsWindow): number {
  switch (window) {
    case "day":
      return 1 / 24;
    case "week":
    case "month":
      return 1;
    case "all":
      return WEEK_DAYS;
  }
}

export { unitEdges };

/** The columns a tile reads: the page's cut, or its own last N units. */
export function tileEdges(window: TileWindow, page: AnalyticsWindow, nowMs: number, firstMs: number = nowMs): number[] {
  return window === "page" ? windowEdges(page, nowMs, firstMs) : unitEdges(window.unit, window.count, nowMs);
}

/** What a tile's columns are, for their labels and week marks. */
export type ColumnUnit = "minute" | "hour" | "day" | "week";

export function columnUnit(window: TileWindow, page: AnalyticsWindow): ColumnUnit {
  if (window !== "page") return window.unit;
  return page === "day" ? "hour" : page === "all" ? "week" : "day";
}

/** Tasks in any of the statuses: one = row per status, joined by "or". */
const byStatus = (statuses: readonly TaskStatus[]): TileCondition[] => statuses.map((value) => ({ field: "status", op: "eq", value }));

/** A tile of the given id: columns of tasks over the page's period, the patch laid over. */
export function newTile(id: string, patch: Partial<Tile> = {}): Tile {
  return {
    id,
    type: "columns",
    title: "New chart",
    window: "page",
    x: "time",
    y: { metric: "count", field: null },
    breakdown: "status",
    switch: null,
    conditions: [],
    sort: null,
    limit: 20,
    bars: { length: "value", gantt: "fact" },
    figures: [],
    display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
    ...patch,
  };
}

/** Bars name their rows and print their values beside them. */
const BAR_DISPLAY: Tile["display"] = { legend: "bottom", xLabels: true, yLabels: true, grid: { x: null, y: null }, trend: false };

const COPY_MARK = " copy";

/** A duplicate's title: the original's, marked as a copy, cut to fit the title's limit. */
export const copyTitle = (title: string): string => `${title.slice(0, TILE_TITLE_MAX - COPY_MARK.length)}${COPY_MARK}`;

const row = (id: string, height: number, minHeight: number, cells: readonly [string, number][]) => ({
  id,
  height,
  minHeight,
  cells: cells.map(([cellId, weight]) => ({ id: cellId, weight })),
});

/**
 * The screen before the owner changes anything: the figure strip as four
 * tiles of figures, then the charts the screen always had — status flow and
 * burndown, the closed charts, inflow against work in progress, the estimate
 * rows, what is stuck and what kind of work got done — and the Gantt last.
 */
export function defaultDashboard(): Dashboard {
  const tiles: Tile[] = [
    newTile("work", { type: "big", title: "Work", figures: ["open", "in_progress", "in_review", "done"] }),
    newTile("period", { type: "big", title: "This period", figures: ["created", "closed", "cycle"] }),
    newTile("time", { type: "big", title: "Time", figures: ["planned", "actual"] }),
    newTile("money", { type: "big", title: "Money", figures: ["budget", "cost", "limit"] }),
    newTile("changes", { title: "Status changes", y: { metric: "moves", field: null } }),
    newTile("burndown", {
      title: "Burndown",
      conditions: byStatus(OPEN_STATUSES),
      switch: "project",
      display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: true },
    }),
    newTile("closed-hourly", { title: "Closed — last 24 hours", window: { unit: "hour", count: 24 }, y: { metric: "closed", field: null }, breakdown: "project" }),
    newTile("closed-daily", { title: "Closed — last 30 days", window: { unit: "day", count: 30 }, y: { metric: "closed", field: null }, breakdown: "project" }),
    newTile("created-closed", { title: "Created vs closed", y: { metric: "createdClosed", field: null }, breakdown: null }),
    newTile("wip", { title: "Work in progress", conditions: byStatus(["in_progress", "in_review"]) }),
    newTile("cycle", { type: "bars", title: "Cycle time", x: "estimate", y: { metric: "cycle", field: null }, breakdown: null, display: BAR_DISPLAY }),
    newTile("accuracy", { type: "bars", title: "Estimate accuracy", x: "estimate", y: { metric: "accuracy", field: null }, breakdown: null, display: BAR_DISPLAY }),
    newTile("cost", {
      type: "ring",
      title: "Cost by project",
      x: "project",
      y: { metric: "sum", field: "cost" },
      breakdown: null,
      sort: { by: "value", direction: "desc" },
      display: { legend: "right", xLabels: false, yLabels: false, grid: { x: null, y: null }, trend: false },
    }),
    newTile("aging", {
      type: "list",
      title: "Stuck tasks",
      conditions: byStatus(["todo", "in_progress", "in_review"]),
      sort: { by: "timeInStatus", direction: "desc" },
      limit: 15,
    }),
    newTile("types", { title: "Closed by type", window: { unit: "day", count: 56 }, y: { metric: "closed", field: null }, breakdown: "type" }),
    newTile("gantt", { type: "bars", title: "Gantt", breakdown: null, bars: { length: "range", gantt: "fact" }, limit: 200 }),
  ];
  return {
    version: 1,
    tiles,
    rows: [
      row("figures", 176, 112, [["work", 0.28], ["period", 0.28], ["time", 0.2], ["money", 0.24]]),
      row("activity", 260, 180, [["changes", 0.6], ["burndown", 0.4]]),
      row("closed", 320, 200, [["closed-hourly", 0.5], ["closed-daily", 0.5]]),
      row("flow", 240, 180, [["created-closed", 0.5], ["wip", 0.5]]),
      row("estimates", 240, 180, [["cycle", 0.34], ["accuracy", 0.34], ["cost", 0.32]]),
      row("attention", 280, 180, [["aging", 0.55], ["types", 0.45]]),
      row("timeline", 360, 200, [["gantt", 1]]),
    ],
  };
}
