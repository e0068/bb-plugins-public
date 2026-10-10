// Layer: shared, pure. What a task field is to a filter and to a sort — the
// one place the filter menu, the board and the table read it from, so a
// field added to the Display menu is filtered and sorted everywhere at once.
//
// Type-only import of contract.ts: the frontend bundle must not pull zod or
// the server SDK in (client/data.ts does the same).
import type { SavedViewFilters, Task } from "./contract.js";
import {
  ACTIVITY_VALUES,
  FIELD_FILTER_KINDS,
  LISTED_FILTER_KEYS,
  MAIN_CHECKOUT,
  QUERY_FIELDS,
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type DateField,
  type FilterKind,
  type ListedFilterField,
  type ListSort,
  type NumberField,
  type QueryField,
  type SortField,
  type TableSortDirection,
  type TextField,
  type ValueFilterField,
} from "./enums.js";
import { firstParagraph } from "./first-paragraph.js";
import { slugOf } from "./format.js";
import { idsUnder } from "./subtree.js";

/** How a field is filtered — every field has a kind (FIELD_FILTER_KINDS). */
export const fieldKind = (field: QueryField): FilterKind => FIELD_FILTER_KINDS[field];

/** A field together with its filter's kind, the field narrowed to that kind's fields. */
export type FilterTarget =
  | { kind: "listed"; field: ListedFilterField }
  | { kind: "values"; field: ValueFilterField }
  | { kind: "text"; field: TextField }
  | { kind: "date"; field: DateField }
  | { kind: "number"; field: NumberField };

/**
 * The field as its filter sees it. The one cast is sound: enums.ts checks at
 * compile time that each kind's field list is exactly the fields of that kind.
 */
export const filterTarget = (field: QueryField): FilterTarget => ({ kind: fieldKind(field), field }) as FilterTarget;

/**
 * What a field's value needs beyond the task itself: names and keys other
 * tasks and projects carry, and the counts the board's card meta and the
 * table's row meta load. A missing entry reads as unnamed or zero.
 */
export interface TaskFacts {
  projectNames: ReadonlyMap<string, string>;
  taskKeys: ReadonlyMap<string, string>;
  labelNames: ReadonlyMap<string, string>;
  activeCounts: ReadonlyMap<string, number>;
  descendantCounts: ReadonlyMap<string, number>;
  /** Per task, the open tasks at every depth under it. */
  openCounts: ReadonlyMap<string, number>;
  attachmentCounts: ReadonlyMap<string, number>;
}

const NOTHING: ReadonlyMap<string, never> = new Map<string, never>();

export const EMPTY_FACTS: TaskFacts = {
  projectNames: NOTHING,
  taskKeys: NOTHING,
  labelNames: NOTHING,
  activeCounts: NOTHING,
  descendantCounts: NOTHING,
  openCounts: NOTHING,
  attachmentCounts: NOTHING,
};

/** Facts from whichever of them a surface knows; the rest read as empty. */
export const factsOf = (known: Partial<TaskFacts>): TaskFacts => ({ ...EMPTY_FACTS, ...known });

/** A sort by one field in one direction. */
export interface ColumnSort {
  column: SortField;
  direction: TableSortDirection;
}

/**
 * A sort as a view or a board stores it: a field and a direction, or — as
 * written before sorts had a direction — one of the list sorts, "manual"
 * being unsorted. Old records stay valid as they are.
 */
export type ViewSort = ListSort | ColumnSort;

/** The field and direction a stored sort names; null — unsorted, the manual order. */
export function viewSortColumn(sort: ViewSort): ColumnSort | null {
  if (typeof sort !== "string") return sort;
  switch (sort) {
    case "manual":
      return null;
    case "priority":
      return { column: "priority", direction: "asc" };
    case "due":
      return { column: "dueDate", direction: "asc" };
    case "start":
      return { column: "startDate", direction: "asc" };
    case "estimate":
      return { column: "estimate", direction: "desc" };
    case "planned_minutes":
      return { column: "plannedMinutes", direction: "desc" };
    case "actual_minutes":
      return { column: "actualMinutes", direction: "desc" };
    case "budget":
      return { column: "budget", direction: "desc" };
    case "budget_limit":
      return { column: "budgetLimit", direction: "desc" };
    case "cost":
      return { column: "cost", direction: "desc" };
    case "created":
      return { column: "createdAt", direction: "desc" };
    case "updated":
      return { column: "updatedAt", direction: "desc" };
  }
}

const rankOf = <T extends string>(order: readonly T[]) => {
  const ranks = new Map<string, number>(order.map((value, index) => [value, index]));
  return (value: string | null | undefined): number | null => (value == null ? null : (ranks.get(value) ?? null));
};

const STATUS_RANK = rankOf(TASK_STATUSES);
const PRIORITY_RANK = rankOf(TASK_PRIORITIES);
const ESTIMATE_RANK = rankOf(TASK_ESTIMATES);

/** The branch a task was read from; null for the main checkout. */
export function worktreeOf(task: Task): string | null {
  const origin = task.source?.origin;
  if (origin?.kind !== "worktree") return null;
  return origin.branchName ?? origin.name ?? origin.environmentId;
}

/** Text order: case aside, numbers in it read as numbers (TSK-9 before TSK-10). One collator — building one per comparison is a hundred times slower. */
const COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const keyOf = (id: string | null | undefined, facts: TaskFacts): string | null =>
  id == null ? null : (facts.taskKeys.get(id) ?? null);

const orNull = (text: string): string | null => (text === "" ? null : text);

/** A field's value as it orders: text, a number or rank, or null for empty. */
function sortValue(field: SortField, task: Task, facts: TaskFacts): string | number | null {
  switch (field) {
    case "title":
      return task.title;
    case "description":
      return orNull(firstParagraph(task.description));
    case "key":
      return task.key;
    case "slug":
      return slugOf(task.id);
    case "status":
      return STATUS_RANK(task.status);
    case "priority":
      return PRIORITY_RANK(task.priority);
    case "estimate":
      return ESTIMATE_RANK(task.estimate);
    case "type":
      return task.type ?? null;
    case "assignee":
      return task.assignee ?? null;
    case "parent":
      return keyOf(task.parentTaskId, facts);
    case "project":
      return facts.projectNames.get(task.projectId) ?? task.projectId;
    case "flow":
      return task.flow?.name ?? null;
    case "worktree":
      return worktreeOf(task);
    case "takenBy":
      return task.takenBy?.machine ?? null;
    case "labels":
      return (
        task.labelIds
          .map((id) => facts.labelNames.get(id) ?? id)
          .sort(COLLATOR.compare)[0] ?? null
      );
    case "active":
      return (facts.activeCounts.get(task.id) ?? 0) || null;
    case "subtasks":
      return facts.descendantCounts.get(task.id) ?? 0;
    case "openSubtasks":
      return facts.openCounts.get(task.id) ?? 0;
    case "attachments":
      return facts.attachmentCounts.get(task.id) ?? 0;
    case "plannedMinutes":
    case "actualMinutes":
    case "budget":
    case "budgetLimit":
    case "cost":
      return task[field];
    case "dueDate":
      return task.dueDate;
    case "startDate":
      return task.startDate;
    case "createdAt":
      return task.createdAt;
    case "updatedAt":
      return task.updatedAt;
    case "subtaskList":
    case "subtaskStats":
    case "burndown":
    case "gantt":
      return null;
  }
}

/**
 * A comparator over tasks for one field and direction. Empty values sort
 * last both ways; text compares case-insensitively with numbers in it read
 * as numbers (TSK-9 before TSK-10); status, priority and estimate by their
 * canonical order.
 */
export function compareByField(sort: ColumnSort, facts: TaskFacts): (a: Task, b: Task) => number {
  const direction = sort.direction === "asc" ? 1 : -1;
  return (a, b) => {
    const left = sortValue(sort.column, a, facts);
    const right = sortValue(sort.column, b, facts);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    if (typeof left === "string" && typeof right === "string") {
      return direction * COLLATOR.compare(left, right) || 0;
    }
    // `|| 0`: a tie in descending order is -0, which reads as "before" to Object.is.
    return direction * ((left as number) - (right as number)) || 0;
  };
}

/** The values a picked-from-a-list filter reads off a task. */
function filterValue(field: ValueFilterField, task: Task, facts: TaskFacts): string | null {
  switch (field) {
    case "project":
      return task.projectId;
    case "flow":
      return task.flow?.name ?? null;
    case "worktree":
      return worktreeOf(task) ?? MAIN_CHECKOUT;
    case "takenBy":
      return task.takenBy?.machine ?? null;
    case "active":
      return (facts.activeCounts.get(task.id) ?? 0) > 0 ? ACTIVITY_VALUES[0] : ACTIVITY_VALUES[1];
  }
}

function textValue(field: TextField, task: Task): string {
  switch (field) {
    case "title":
      return task.title;
    case "description":
      return task.description;
    case "key":
      return task.key;
    case "slug":
      return slugOf(task.id);
  }
}

/** A date field as a day, YYYY-MM-DD; timestamps by their UTC day. */
function dayValue(field: DateField, task: Task): string | null {
  const value = task[field];
  return value === null ? null : value.slice(0, 10);
}

export function numberValue(field: NumberField, task: Task, facts: TaskFacts): number | null {
  switch (field) {
    case "subtasks":
      return facts.descendantCounts.get(task.id) ?? 0;
    case "attachments":
      return facts.attachmentCounts.get(task.id) ?? 0;
    case "plannedMinutes":
    case "actualMinutes":
    case "budget":
    case "budgetLimit":
    case "cost":
      return task[field];
  }
}

export interface Range<T> {
  from: T | null;
  to: T | null;
  /** Tasks without a value pass too. */
  empty: boolean;
}

/** Whether a range narrows anything: a bound set, or the empty mark alone. */
export const rangeActive = (range: Range<unknown>): boolean =>
  range.from !== null || range.to !== null || range.empty;

/**
 * Whether a value lies in a range. An empty value passes only when marked;
 * a present one only when a bound is set and holds — so the empty mark
 * alone keeps just the tasks without a value.
 */
function inRange<T extends string | number>(value: T | null, range: Range<T>): boolean {
  if (!rangeActive(range)) return true;
  if (value === null) return range.empty;
  if (range.from === null && range.to === null) return false;
  return (range.from === null || value >= range.from) && (range.to === null || value <= range.to);
}

const entries = <K extends string, V>(record: Partial<Record<K, V>>) =>
  Object.entries(record) as [K, V | undefined][];

/**
 * Whether a task passes the filters added after the first seven (statuses …
 * parents — see matchesFilters below): picked values, text, day and
 * number ranges. Every filter must hold; an empty one holds for any task.
 */
export function matchesFieldFilters(task: Task, filters: SavedViewFilters, facts: TaskFacts): boolean {
  return (
    entries(filters.values ?? {}).every(([field, picked]) => {
      if (picked === undefined || picked.length === 0) return true;
      const value = filterValue(field, task, facts);
      return value !== null && picked.includes(value);
    }) &&
    entries(filters.texts ?? {}).every(([field, needle]) => {
      const wanted = (needle ?? "").trim().toLowerCase();
      return wanted === "" || textValue(field, task).toLowerCase().includes(wanted);
    }) &&
    entries(filters.dates ?? {}).every(([field, range]) => range === undefined || inRange(dayValue(field, task), range)) &&
    entries(filters.numbers ?? {}).every(([field, range]) => range === undefined || inRange(numberValue(field, task, facts), range))
  );
}

/**
 * Whether a task survives the filter bar. Labels use the server's any-of
 * semantics: a task matches if it carries at least one selected label id. Takes the filter state whole: the
 * six positional lists this used to accept were all arrays of strings, and
 * two more (assignees, parents) would have made a wrong argument order a
 * defect types could not catch. Label ids and the tasks under the picked
 * parents stay separate — they arrive already resolved, the ids from the
 * names the state stores, the tasks from the tree (`idsUnder`); with no
 * parent picked, nothing needs to lie under one. Every other field's filter
 * reads what the task alone does not carry — agents, counts, names — from
 * `facts`, which the surface builds from its own meta.
 */
export function matchesFilters(
  task: Task,
  filters: SavedViewFilters,
  labelIds: readonly string[],
  underParents: ReadonlySet<string> = new Set(),
  facts: TaskFacts = EMPTY_FACTS,
): boolean {
  const inList = <T,>(list: readonly T[], value: T | null | undefined) =>
    list.length === 0 || (value != null && list.includes(value));
  return (
    inList(filters.statuses, task.status) &&
    inList(filters.priorities, task.priority) &&
    (labelIds.length === 0 ||
      task.labelIds.some((id) => labelIds.includes(id))) &&
    inList(filters.types, task.type) &&
    inList(filters.estimates, task.estimate) &&
    inList(filters.assignees, task.assignee) &&
    (filters.parents.length === 0 || underParents.has(task.id)) &&
    matchesFieldFilters(task, filters, facts)
  );
}

/**
 * The tasks a filter bar keeps, resolved from the tasks alone: label names
 * through `facts`, the picked parents through the tree of `tasks`. A label
 * filter naming no known label keeps nothing, as on a board.
 */
export function tasksPassing(tasks: readonly Task[], filters: SavedViewFilters, facts: TaskFacts): Task[] {
  const labelIds = [...facts.labelNames].filter(([, name]) => filters.labelNames.includes(name)).map(([id]) => id);
  if (filters.labelNames.length > 0 && labelIds.length === 0) return [];
  const underParents = idsUnder(tasks, filters.parents);
  return tasks.filter((task) => matchesFilters(task, filters, labelIds, underParents, facts));
}

/** Whether the filter on one field narrows anything. */
function fieldActive(filters: SavedViewFilters, field: QueryField): boolean {
  const target = filterTarget(field);
  switch (target.kind) {
    case "listed":
      return filters[LISTED_FILTER_KEYS[target.field]].length > 0;
    case "values":
      return (filters.values?.[target.field]?.length ?? 0) > 0;
    case "text":
      return (filters.texts?.[target.field] ?? "").trim() !== "";
    case "date": {
      const range = filters.dates?.[target.field];
      return range !== undefined && rangeActive(range);
    }
    case "number": {
      const range = filters.numbers?.[target.field];
      return range !== undefined && rangeActive(range);
    }
  }
}

/** The fields a filter narrows, in the canonical field order — one chip each. */
export const activeFilterFields = (filters: SavedViewFilters): QueryField[] =>
  QUERY_FIELDS.filter((field) => fieldActive(filters, field));
