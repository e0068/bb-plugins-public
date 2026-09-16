import { TASK_ESTIMATES, TASK_PRIORITIES } from "./enums.js";
import type { Task } from "./contract.js";
import type { AmountField } from "./amounts.js";

export { TASK_SORTS, type TaskSort } from "./pagination.js";

/**
 * Client-side list sorts. A superset of the server's keyset sorts
 * (manual/priority/due): estimate, time and money sorts are applied in-memory over
 * the fully-loaded list, so they never touch the server keyset pagination.
 */
export const LIST_SORTS = [
  "manual",
  "priority",
  "due",
  "estimate",
  "planned_minutes",
  "actual_minutes",
  "budget",
  "budget_limit",
  "cost",
  "created",
  "updated",
] as const;

export type ListSort = (typeof LIST_SORTS)[number];

const PRIORITY_RANK = new Map<Task["priority"], number>(
  TASK_PRIORITIES.map((priority, index) => [priority, index]),
);

const ESTIMATE_RANK = new Map<NonNullable<Task["estimate"]>, number>(
  TASK_ESTIMATES.map((estimate, index) => [estimate, index]),
);

function byPriority(a: Task, b: Task): number {
  return (
    (PRIORITY_RANK.get(a.priority) ?? TASK_PRIORITIES.length) -
    (PRIORITY_RANK.get(b.priority) ?? TASK_PRIORITIES.length)
  );
}

/** Earliest due date first; tasks without a due date sort last. */
function byDueDate(a: Task, b: Task): number {
  if (a.dueDate === null) return b.dueDate === null ? 0 : 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

/** Largest estimate first (xl → xs); tasks without an estimate sort last. */
function byEstimate(a: Task, b: Task): number {
  const ra = a.estimate === null ? -1 : (ESTIMATE_RANK.get(a.estimate) ?? -1);
  const rb = b.estimate === null ? -1 : (ESTIMATE_RANK.get(b.estimate) ?? -1);
  return rb - ra;
}

/** Highest amount first; tasks without a value sort last. */
function byAmount(field: AmountField) {
  return (a: Task, b: Task): number => {
    const va = a[field];
    const vb = b[field];
    if (va === null) return vb === null ? 0 : 1;
    if (vb === null) return -1;
    return vb - va;
  };
}

/**
 * Newest first. `createdAt`/`updatedAt` are non-nullable ISO-8601 UTC
 * timestamps, so string order is chronological order — no Date parsing, and
 * no "missing values last" branch the other sorts need.
 */
function byTimestamp(field: "createdAt" | "updatedAt") {
  return (a: Task, b: Task): number => {
    const va = a[field];
    const vb = b[field];
    return va < vb ? 1 : va > vb ? -1 : 0;
  };
}

const PRIMARY: Record<Exclude<ListSort, "manual">, (a: Task, b: Task) => number> =
  {
    priority: byPriority,
    due: byDueDate,
    estimate: byEstimate,
    planned_minutes: byAmount("plannedMinutes"),
    actual_minutes: byAmount("actualMinutes"),
    budget: byAmount("budget"),
    budget_limit: byAmount("budgetLimit"),
    cost: byAmount("cost"),
    created: byTimestamp("createdAt"),
    updated: byTimestamp("updatedAt"),
  };

/**
 * Returns a new array ordered by the requested sort. "manual" keeps the
 * server's order (board position within status). Every other sort uses its
 * field as the primary key, then priority and due date as stable secondaries;
 * remaining ties keep the server's order (Array.prototype.sort is stable).
 */
export function sortTasks(tasks: readonly Task[], sort: ListSort): Task[] {
  if (sort === "manual") return [...tasks];
  const primary = PRIMARY[sort];
  return [...tasks].sort(
    (a, b) => primary(a, b) || byPriority(a, b) || byDueDate(a, b),
  );
}
