// Pure core of a card's sub-task burndown: how many of the tasks under a card
// still owed work at the end of each day, and when the trend reaches zero.
// The RPC handler (api/index.ts) hands it the tasks, the transition log and
// the column ends; the reading of the log is the flow charts' own (flow.ts).
import type { StatusTransition } from "../db/transition-log.js";
import { ALL_TIME, type CardChartPeriod } from "../shared/enums.js";
import type { TaskStatus } from "../db/types.js";
import type { Task } from "../shared/contract.js";
import { createdMs, movesByTask, statusBefore } from "./flow.js";
import { trendOf } from "./trend.js";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** `count + 1` ends a `stepMs` apart, the last one now. */
const endsBack = (nowMs: number, count: number, stepMs: number) =>
  Array.from({ length: count + 1 }, (_, index) => nowMs - (count - index) * stepMs);

/**
 * Where a card's burndown reads its tasks: the day ends of the period's days,
 * or for all time the week ends back to the week holding `firstMs` — the
 * oldest task under the card; an unreadable one gives a single week. The
 * last end is now.
 */
export function burndownEnds(period: CardChartPeriod, nowMs: number, firstMs: number): number[] {
  if (period !== ALL_TIME) return endsBack(nowMs, period, DAY_MS);
  const weeks = Number.isFinite(firstMs) ? Math.ceil((nowMs - firstMs) / WEEK_MS) : 1;
  return endsBack(nowMs, Math.max(1, weeks), WEEK_MS);
}

/** Statuses that still owe work — what a burndown burns down. */
const OPEN: ReadonlySet<TaskStatus> = new Set(["backlog", "todo", "in_progress", "in_review"]);

/** Per end, the tasks made before it that stood open just before it — over moves already grouped by task (`movesByTask`), so a board's worth of series reads the log once. */
export function openSeriesOf(
  tasks: readonly Task[],
  moves: ReadonlyMap<string, readonly StatusTransition[]>,
  ends: readonly number[],
): number[] {
  return ends.map(
    (end) =>
      tasks.filter((task) => createdMs(task) < end && OPEN.has(statusBefore(task, moves.get(task.id) ?? [], end))).length,
  );
}

/** The same series straight off the log. */
export const openSeries = (tasks: readonly Task[], transitions: readonly StatusTransition[], ends: readonly number[]): number[] =>
  openSeriesOf(tasks, movesByTask(transitions), ends);

/** Days until the trend line reaches zero at its pace, a column spanning `columnDays`; null while it does not fall. */
export function forecastDays(series: readonly number[], columnDays = 1): number | null {
  const trend = trendOf(series);
  if (trend === null || trend.slope >= 0) return null;
  return Math.ceil((series[series.length - 1]! / -trend.slope) * columnDays);
}
