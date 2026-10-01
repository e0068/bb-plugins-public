// Pure model of the analytics screen: the sections and the rows they stand in
// before the owner resizes anything, the filter, and the columns each D/W/M
// cut is drawn in. No React — AnalyticsDashboard.tsx renders this. Columns
// are local-calendar (see closed-model.ts), so the client computes them.
import { WINDOWS, type Window } from "@bb-plugins/analytics-viz/core/time-window";
import { weekBreaks, weekEdgesSince, type WeekBreak } from "@bb-plugins/analytics-viz/core/weeks";
import { dayEdges, hourEdges } from "./closed-model";
import type { RowLayout } from "./row-layout";

/** Every section of the screen; the id doubles as its kind — one section per kind. */
export const SECTION_KINDS = [
  "changes",
  "burndown",
  "closed-hourly",
  "closed-daily",
  "created-closed",
  "wip",
  "cycle",
  "accuracy",
  "cost",
  "aging",
  "types",
  "gantt",
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** The cuts of the screen: the rolling D/W/M every analytics surface offers, then the whole history. */
export const ANALYTICS_WINDOWS = [...WINDOWS, "all"] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

/** What the screen is narrowed to: a cut and the projects picked in the header (none picked — all). */
export interface AnalyticsFilter {
  window: AnalyticsWindow;
  projectIds: readonly string[];
}

export const DEFAULT_FILTER: AnalyticsFilter = { window: "week", projectIds: [] };

const WEEK_DAYS = 7;
const WEEKS = 8;

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

/** The 8 local weeks ending with the current one: 9 Monday midnights, the last one next Monday's. */
export function weekEdges(nowMs: number): number[] {
  const now = new Date(nowMs);
  const sinceMonday = (now.getDay() + 6) % WEEK_DAYS;
  const firstDay = now.getDate() - sinceMonday - (WEEKS - 1) * WEEK_DAYS;
  return Array.from({ length: WEEKS + 1 }, (_, week) =>
    new Date(now.getFullYear(), now.getMonth(), firstDay + week * WEEK_DAYS).getTime(),
  );
}

const row = (id: string, height: number, minHeight: number, cells: readonly [SectionKind, number][]) => ({
  id,
  height,
  minHeight,
  cells: cells.map(([cellId, weight]) => ({ id: cellId, weight })),
});

/**
 * The rows before any resize: status flow and burndown, the closed charts,
 * inflow against work in progress, the estimate rows, what is stuck and what
 * kind of work got done, then the Gantt of the tasks. The last row grows to
 * the bottom of the screen.
 */
export function defaultAnalyticsRows(): RowLayout {
  return {
    rows: [
      row("activity", 260, 180, [["changes", 0.6], ["burndown", 0.4]]),
      row("closed", 320, 200, [["closed-hourly", 0.5], ["closed-daily", 0.5]]),
      row("flow", 240, 180, [["created-closed", 0.5], ["wip", 0.5]]),
      row("estimates", 240, 180, [["cycle", 0.34], ["accuracy", 0.34], ["cost", 0.32]]),
      row("attention", 280, 180, [["aging", 0.55], ["types", 0.45]]),
      row("timeline", 360, 200, [["gantt", 1]]),
    ],
  };
}
