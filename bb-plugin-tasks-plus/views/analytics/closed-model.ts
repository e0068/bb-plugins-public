// Pure model of the "closed tasks" charts: the column edges the client asks
// the server for, the stacked rows the chart draws, the project colours and the
// tasks behind a clicked segment. No React, no RPC — closed-section.tsx
// renders this. The edges are local-calendar: an hour starts on the viewer's
// clock hour and a day on the viewer's midnight, which is why the client and
// not the server computes them.
import type { ClosedTask } from "../../shared/contract.js";
import { OVERFLOW_COLOR, PROJECT_PALETTE } from "./palette";

const HOUR_MS = 3_600_000;
const HOURS = 24;
const DAYS = 30;

/** Column edges: column `i` is `[edges[i], edges[i + 1])`, so n columns take n + 1 edges. */
export type Edges = readonly number[];

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

/** The 24 hours ending with the current local hour: 25 edges, the last one where the current hour ends. */
export function hourEdges(nowMs: number): number[] {
  const hourStart = new Date(nowMs);
  hourStart.setMinutes(0, 0, 0);
  const firstMs = hourStart.getTime() - (HOURS - 1) * HOUR_MS;
  return range(HOURS + 1).map((index) => firstMs + index * HOUR_MS);
}

/**
 * The 30 local days ending with today: 31 local midnights, the last one
 * tomorrow's. Built from calendar fields, not by adding 24 hours, so a
 * daylight-saving day keeps its 23 or 25 hours and every edge stays a midnight.
 */
export function dayEdges(nowMs: number): number[] {
  const now = new Date(nowMs);
  const firstDay = now.getDate() - (DAYS - 1);
  return range(DAYS + 1).map((index) => new Date(now.getFullYear(), now.getMonth(), firstDay + index).getTime());
}

/** One chart column: its index and how many tasks each project closed in it (absent = none). */
export interface StackRow {
  bin: number;
  counts: Record<string, number>;
}

/** A row for each of `binCount` columns — empty ones included, so the axis has no gaps. */
export function stackRows(closings: readonly Pick<ClosedTask, "projectId" | "bin">[], binCount: number): StackRow[] {
  return range(binCount).map((bin) => ({
    bin,
    counts: closings
      .filter((closing) => closing.bin === bin)
      .reduce<Record<string, number>>(
        (counts, { projectId }) => ({ ...counts, [projectId]: (counts[projectId] ?? 0) + 1 }),
        {},
      ),
  }));
}

/** Categorical slots in fixed order (palette.ts); past the last one a project is drawn muted. */
export const SERIES_SLOTS = PROJECT_PALETTE.length;

export function seriesColor(index: number): string {
  return PROJECT_PALETTE[index] ?? OVERFLOW_COLOR;
}

/** A project as a chart series: its segments, its legend entry. */
export interface ProjectSeries {
  id: string;
  name: string;
  color: string;
}

/**
 * The projects that closed something in the window, in board order. The
 * colour follows the project's place on the whole board — not its rank in
 * this window — so the hourly and daily charts paint a project the same.
 * A project the board no longer lists comes after the board's, named by id.
 */
export function projectSeries(
  closings: readonly Pick<ClosedTask, "projectId">[],
  projects: readonly { id: string; name: string }[],
  colorAt: (index: number) => string = seriesColor,
): ProjectSeries[] {
  const closedIds = new Set(closings.map((closing) => closing.projectId));
  const known = new Set(projects.map((project) => project.id));
  const unknown = [...closedIds].filter((id) => !known.has(id)).map((id) => ({ id, name: id }));
  return [...projects, ...unknown]
    .map((project, index) => ({ ...project, color: colorAt(index) }))
    .filter((project) => closedIds.has(project.id));
}

/** A clicked segment: one column of one project. */
export interface Segment {
  bin: number;
  projectId: string;
}

/** The tasks behind a segment, newest first. */
export function closingsIn(closings: readonly ClosedTask[], segment: Segment): ClosedTask[] {
  return closings
    .filter((closing) => closing.bin === segment.bin && closing.projectId === segment.projectId)
    .sort((a, b) => b.atMs - a.atMs);
}
