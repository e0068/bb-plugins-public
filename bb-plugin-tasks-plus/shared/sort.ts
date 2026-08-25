import {
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  type Task,
} from "./contract.js";

export { TASK_SORTS, type TaskSort } from "./pagination.js";

/**
 * Client-side list sorts. A superset of the server's keyset sorts
 * (manual/priority/due): estimate and token sorts are applied in-memory over
 * the fully-loaded list, so they never touch the server keyset pagination.
 */
export const LIST_SORTS = [
  "manual",
  "priority",
  "due",
  "estimate",
  "plan_tokens",
  "fact_tokens",
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

/** Highest token count first; tasks without a value sort last. */
function byTokens(field: "planTokens" | "factTokens") {
  return (a: Task, b: Task): number => {
    const va = a[field];
    const vb = b[field];
    if (va === null) return vb === null ? 0 : 1;
    if (vb === null) return -1;
    return vb - va;
  };
}

const PRIMARY: Record<Exclude<ListSort, "manual">, (a: Task, b: Task) => number> =
  {
    priority: byPriority,
    due: byDueDate,
    estimate: byEstimate,
    plan_tokens: byTokens("planTokens"),
    fact_tokens: byTokens("factTokens"),
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
