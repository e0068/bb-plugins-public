// Pure aggregation behind the analytics RPC (BBPL-258): a current-state
// snapshot over the task list. Pure and total — no I/O, no clock, no DB. The
// RPC handler (api/index.ts) hands it the tasks it fetched; everything over
// time lives in ./flow.
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from "../db/types.js";
import type { TaskPriority, TaskStatus, TaskType } from "../db/types.js";
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
