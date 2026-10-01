import type { Task } from "./contract.js";
import { EMPTY_FACTS, compareByField, viewSortColumn, type TaskFacts, type ViewSort } from "./task-fields.js";

export { TASK_SORTS, type TaskSort } from "./pagination.js";

// The sort dictionary lives in enums.ts; re-exported here so every existing
// importer of `shared/sort.js` keeps working.
export { LIST_SORTS, type ListSort } from "./enums.js";

const BY_PRIORITY = { column: "priority", direction: "asc" } as const;
const BY_DUE_DATE = { column: "dueDate", direction: "asc" } as const;

/**
 * Returns a new array ordered by the requested sort. Unsorted ("manual")
 * keeps the server's order — the project's manual order
 * (shared/manual-order.ts). Any other sort orders by its field and
 * direction (shared/task-fields.ts), then by priority and due date as
 * stable secondaries; remaining ties keep the server's order
 * (Array.prototype.sort is stable). A list sort stored before sorts had a
 * direction orders as it always did.
 */
export function sortTasks(tasks: readonly Task[], sort: ViewSort, facts: TaskFacts = EMPTY_FACTS): Task[] {
  const column = viewSortColumn(sort);
  if (column === null) return [...tasks];
  const comparators = [column, BY_PRIORITY, BY_DUE_DATE].map((by) => compareByField(by, facts));
  return [...tasks].sort((a, b) => comparators.reduce((order, compare) => order || compare(a, b), 0));
}
