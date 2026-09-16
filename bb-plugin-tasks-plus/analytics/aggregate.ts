// Pure aggregation behind the analytics RPC (BBPL-258): a current-state
// snapshot over the task list, and a bucketed time-series over the transition
// log. Pure and total — no I/O, no clock, no DB. The RPC handlers
// (api/index.ts) hand it the rows they fetched; the binning itself comes from
// the shared engine (packages/analytics-viz core), so tasks-plus doesn't
// reimplement it.
import { bucketByTime } from "../packages/analytics-viz/core/binning";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from "../db/types.js";
import type { TaskPriority, TaskStatus, TaskType } from "../db/types.js";
import type { StatusTransition } from "../db/transition-log.js";
import { roundToCents, type AmountField } from "../shared/amounts.js";
import type { Task } from "../shared/contract.js";

/** The "untyped" bucket for tasks whose `type` is null — a real cut, kept apart from the named types. */
export const UNTYPED_KEY = "untyped" as const;

/** A count for every member of an enum (all keys present, zero when none) — a chart reads a fixed set of bars. */
type CountsByStatus = Record<TaskStatus, number>;
type CountsByPriority = Record<TaskPriority, number>;
type CountsByType = Record<TaskType | typeof UNTYPED_KEY, number>;

/** Current state of a task set: how many sit in each status/priority/type, and their time and money totals. */
export interface TasksSnapshot {
  total: number;
  byStatus: CountsByStatus;
  byPriority: CountsByPriority;
  byType: CountsByType;
  /** Sums of the non-null values across the set: minutes, and dollars on whole cents. */
  plannedMinutes: number;
  actualMinutes: number;
  budget: number;
  budgetLimit: number;
  cost: number;
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

/**
 * Snapshot of `tasks` as they stand now: totals by status, priority and type,
 * plus summed time and money. Total on every input — an empty set is a valid
 * snapshot of all-zeroes, a null amount is simply not added.
 */
export function snapshotOf(tasks: readonly Task[]): TasksSnapshot {
  const byStatus = zeroed(TASK_STATUSES);
  const byPriority = zeroed(TASK_PRIORITIES);
  const byType = zeroed([...TASK_TYPES, UNTYPED_KEY]);
  const sum = (field: AmountField) =>
    tasks.reduce((total, task) => total + (task[field] ?? 0), 0);

  for (const task of tasks) {
    byStatus[task.status] += 1;
    byPriority[task.priority] += 1;
    byType[task.type ?? UNTYPED_KEY] += 1;
  }

  return {
    total: tasks.length,
    byStatus,
    byPriority,
    byType,
    plannedMinutes: sum("plannedMinutes"),
    actualMinutes: sum("actualMinutes"),
    budget: roundToCents(sum("budget")),
    budgetLimit: roundToCents(sum("budgetLimit")),
    cost: roundToCents(sum("cost")),
  };
}

/** The window a series is bucketed over. */
export interface SeriesWindow {
  fromMs: number;
  toMs: number;
  binMs: number;
}

/**
 * Bucketed counts of status transitions over `window`: one grid (from the
 * shared bucketByTime), a total series, and a per-destination-status series
 * (transitions INTO each status — throughput). Every series shares the same
 * bin grid, so `bins[i]` labels column `i` of every one of them.
 *
 * `total` counts every transition in the window; `byToStatus` only counts the
 * known {@link TaskStatus} values. They coincide (byToStatus sums, bin by bin,
 * to total) exactly when every transition's `toStatus` is a known status —
 * which the only writer (boardMove/updateTask) guarantees, since it always
 * writes a `TaskStatus`. A transition into an unknown status would still land
 * in `total` but in no per-status series.
 *
 * Pure and total: a degenerate window (see bucketByTime) yields empty arrays.
 */
export interface StatusSeries {
  /** Bin start times (epoch ms), ascending — the x-axis shared by every series. */
  bins: number[];
  /** All transitions per bin. */
  total: number[];
  /** Per destination status: transitions whose `toStatus` is that status, per bin. */
  byToStatus: Record<TaskStatus, number[]>;
}

export function seriesFromTransitions(transitions: readonly StatusTransition[], window: SeriesWindow): StatusSeries {
  // One place that knows how a transition maps to (time, metric) and where the
  // grid sits — used for the total series and each per-status series alike.
  const bucketCount = (rows: readonly StatusTransition[]) =>
    bucketByTime(rows, {
      timeMs: (t) => t.atMs,
      value: () => 1,
      fromMs: window.fromMs,
      toMs: window.toMs,
      binMs: window.binMs,
    });

  const grid = bucketCount(transitions);
  const byToStatus = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, bucketCount(transitions.filter((t) => t.toStatus === status)).map((b) => b.value)]),
  ) as Record<TaskStatus, number[]>;

  return {
    bins: grid.map((bin) => bin.startMs),
    total: grid.map((bin) => bin.value),
    byToStatus,
  };
}
