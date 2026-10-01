// Pure helpers of the flow sections (flow-sections.tsx): what is left in a
// project per column, work in progress per column, a least-squares trend for
// the burndown forecast, and durations in words. No React.
import type { TaskStatus } from "../../db/types.js";

type StatusByBin = Readonly<Record<string, readonly Readonly<Record<TaskStatus, number>>[]>>;

/** Statuses that still owe work — what a burndown burns down. */
export const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review"] as const satisfies readonly TaskStatus[];

/** Open tasks of one project at the end of every column. */
export function openByColumn(byBin: StatusByBin, projectId: string): number[] {
  return (byBin[projectId] ?? []).map((counts) => OPEN_STATUSES.reduce((sum, status) => sum + counts[status], 0));
}

/** Per column, [in progress, in review] summed over every project. */
export function wipByColumn(byBin: StatusByBin, columns: number): [number, number][] {
  const projects = Object.values(byBin);
  return Array.from({ length: columns }, (_, column) =>
    projects.reduce<[number, number]>(
      ([progress, review], rows) => [progress + (rows[column]?.in_progress ?? 0), review + (rows[column]?.in_review ?? 0)],
      [0, 0],
    ),
  );
}

// The trend moved to the analytics core, where the card burndown forecasts with it too.
export { trendOf, type Trend } from "../../analytics/trend.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A duration the way the charts print it: "25 min", "5.5 h", "1.8 d". */
export function formatDuration(ms: number): string {
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${(ms / HOUR_MS).toFixed(1)} h`;
  return `${(ms / DAY_MS).toFixed(1)} d`;
}
