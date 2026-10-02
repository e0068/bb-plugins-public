// Pure model of the analytics columns in time: the hour and day edges the
// client asks the server for, the project colours, and how a column's start
// is named. No React, no RPC. The edges are local-calendar: an hour starts on
// the viewer's clock hour and a day on the viewer's midnight, which is why
// the client and not the server computes them.
import { OVERFLOW_COLOR, PROJECT_PALETTE } from "./palette";

const HOUR_MS = 3_600_000;
const HOURS = 24;
const DAYS = 30;

/** Column edges: column `i` is `[edges[i], edges[i + 1])`, so n columns take n + 1 edges. */
export type Edges = readonly number[];

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

const UNIT_MS = { minute: 60_000, hour: HOUR_MS } as const;

/**
 * The last `count` minutes, hours or local days: count + 1 edges, the last one
 * the start of the next minute, hour or day. Days are built from calendar
 * fields, not by adding 24 hours, so a daylight-saving day keeps its 23 or 25
 * hours and every edge stays a midnight.
 */
export function unitEdges(unit: "minute" | "hour" | "day", count: number, nowMs: number): number[] {
  const now = new Date(nowMs);
  if (unit === "day") {
    const firstDay = now.getDate() - (count - 1);
    return range(count + 1).map((index) => new Date(now.getFullYear(), now.getMonth(), firstDay + index).getTime());
  }
  const start = new Date(nowMs);
  start.setSeconds(0, 0);
  if (unit === "hour") start.setMinutes(0);
  const firstMs = start.getTime() - (count - 1) * UNIT_MS[unit];
  return range(count + 1).map((index) => firstMs + index * UNIT_MS[unit]);
}

/** The 24 hours ending with the current local hour: 25 edges, the last one where the current hour ends. */
export const hourEdges = (nowMs: number): number[] => unitEdges("hour", HOURS, nowMs);

/** The 30 local days ending with today: 31 local midnights, the last one tomorrow's. */
export const dayEdges = (nowMs: number): number[] => unitEdges("day", DAYS, nowMs);

/** Categorical slots in fixed order (palette.ts); past the last one a project is drawn muted. */
export const SERIES_SLOTS = PROJECT_PALETTE.length;

export function seriesColor(index: number): string {
  return PROJECT_PALETTE[index] ?? OVERFLOW_COLOR;
}

/** An hour as the viewer's clock shows it, e.g. "14:00". */
export function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A day as the viewer's calendar shows it, e.g. "Sep 24". */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
