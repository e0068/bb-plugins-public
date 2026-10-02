// Layer: shared, pure. The filter of an analytics tile: rows "field · operator
// · value" over any field the board filters by — docs/specs/analitika-filtr-plitki-usloviyami.md.
// Rows of one field with = are joined by "or", every other row by "and"; a
// row whose value is still empty narrows nothing.
//
// Type-only import of contract.ts: the frontend bundle must not pull zod in.
// The operators and the row itself live in analytics-tile.ts, which contract.ts reads.
import type { Task } from "./contract.js";
import { CONDITION_OP_SIGN, CONDITION_OPS, conditionsFromFilters, type ConditionOp, type TileCondition } from "./analytics-tile.js";
import { ACTIVITY_VALUES, FIELD_FILTER_KINDS, MAIN_CHECKOUT, TASK_ESTIMATES, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, type QueryField } from "./enums.js";
import { slugOf } from "./format.js";
import { numberValue, worktreeOf, type TaskFacts } from "./task-fields.js";

/** Fields whose values come from a fixed list, in the order the filter offers them. */
export const LISTED_VALUES: Partial<Record<QueryField, readonly string[]>> = {
  status: TASK_STATUSES,
  priority: TASK_PRIORITIES,
  estimate: TASK_ESTIMATES,
  type: TASK_TYPES,
  active: ACTIVITY_VALUES,
};

/** The same fields from low to high, as > and < read them: priorities are listed most urgent first, so they rise reversed. */
const RISING: Partial<Record<QueryField, readonly string[]>> = {
  ...LISTED_VALUES,
  priority: [...TASK_PRIORITIES].reverse(),
};

/** What a task holds in a field, as a condition compares it. */
type Reading =
  | { kind: "text"; text: string }
  | { kind: "number"; value: number | null }
  | { kind: "day"; value: string | null }
  | { kind: "names"; values: readonly string[] };

const COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const named = (...values: (string | null | undefined)[]): Reading => ({ kind: "names", values: values.filter((value): value is string => value != null && value !== "") });

function reading(field: QueryField, task: Task, facts: TaskFacts): Reading {
  switch (field) {
    case "title":
      return { kind: "text", text: task.title };
    case "description":
      return { kind: "text", text: task.description };
    case "key":
      return { kind: "text", text: task.key };
    case "slug":
      return { kind: "text", text: slugOf(task.id) };
    case "status":
      return named(task.status);
    case "priority":
      return named(task.priority);
    case "estimate":
      return named(task.estimate);
    case "type":
      return named(task.type);
    case "assignee":
      return named(task.assignee);
    case "labels":
      return named(...task.labelIds.map((id) => facts.labelNames.get(id) ?? id));
    case "parent":
      return named(task.parentTaskId == null ? null : facts.taskKeys.get(task.parentTaskId));
    case "epic":
      return named(task.epicId == null ? null : facts.taskKeys.get(task.epicId));
    case "project":
      return named(facts.projectNames.get(task.projectId) ?? task.projectId);
    case "flow":
      return named(task.flow?.name);
    case "worktree":
      return named(worktreeOf(task) ?? MAIN_CHECKOUT);
    case "takenBy":
      return named(task.takenBy?.machine);
    case "active":
      return named((facts.activeCounts.get(task.id) ?? 0) > 0 ? ACTIVITY_VALUES[0] : ACTIVITY_VALUES[1]);
    case "subtasks":
    case "attachments":
    case "plannedMinutes":
    case "actualMinutes":
    case "budget":
    case "budgetLimit":
    case "cost":
      return { kind: "number", value: numberValue(field, task, facts) };
    case "dueDate":
    case "startDate":
      return { kind: "day", value: task[field] };
    case "createdAt":
    case "updatedAt":
      return { kind: "day", value: localMinute(task[field]) };
  }
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A timestamp as the local day and minute, YYYY-MM-DDTHH:mm — the form the plan dates and the typed value use. */
function localMinute(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The order of two values: by the field's own order when it has one, else as text with numbers read as numbers. */
function order(field: QueryField, left: string, right: string): number | null {
  const ranks = RISING[field];
  if (ranks === undefined) return COLLATOR.compare(left, right);
  const [a, b] = [ranks.indexOf(left.toLowerCase()), ranks.indexOf(right.toLowerCase())];
  return a < 0 || b < 0 ? null : a - b;
}

const holds = (op: ConditionOp, difference: number): boolean => {
  switch (op) {
    case "eq":
      return difference === 0;
    case "ne":
      return difference !== 0;
    case "gt":
      return difference > 0;
    case "lt":
      return difference < 0;
  }
};

/** Whether one row holds for a task. A task without a value passes only ≠. */
function holdsFor(condition: TileCondition, task: Task, facts: TaskFacts): boolean {
  const { field, op } = condition;
  const value = condition.value.trim();
  const read = reading(field, task, facts);
  switch (read.kind) {
    case "text": {
      const contains = read.text.toLowerCase().includes(value.toLowerCase());
      return op === "eq" ? contains : op === "ne" ? !contains : holds(op, COLLATOR.compare(read.text, value));
    }
    case "number": {
      const wanted = Number(value);
      if (read.value === null || !Number.isFinite(wanted)) return op === "ne";
      return holds(op, read.value - wanted);
    }
    case "day": {
      // The task's date cut to what the value names: a day, or a day and a minute.
      if (read.value === null) return op === "ne";
      const cut = read.value.slice(0, value.length);
      return holds(op, cut < value ? -1 : cut > value ? 1 : 0);
    }
    case "names": {
      const differences = read.values.map((name) => order(field, name, value)).filter((difference): difference is number => difference !== null);
      return op === "ne" ? differences.every((difference) => difference !== 0) : differences.some((difference) => holds(op, difference));
    }
  }
}

/** Whether a task passes a tile's filter. */
export function matchesConditions(task: Task, conditions: readonly TileCondition[], facts: TaskFacts): boolean {
  const live = conditions.filter((condition) => condition.value.trim() !== "");
  const fields = new Set(live.map((condition) => condition.field));
  return [...fields].every((field) => {
    const rows = live.filter((condition) => condition.field === field);
    const equals = rows.filter((condition) => condition.op === "eq");
    return (equals.length === 0 || equals.some((condition) => holdsFor(condition, task, facts))) && rows.every((condition) => condition.op === "eq" || holdsFor(condition, task, facts));
  });
}

/** How a field's value is typed in: a number, a day, or text. */
export function valueInput(field: QueryField): "number" | "date" | "text" {
  switch (FIELD_FILTER_KINDS[field]) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "listed":
    case "values":
    case "text":
      return "text";
  }
}

/** What the value suggestions are read from: every board's tasks, projects and labels. */
export interface SuggestionScope {
  tasks: readonly Task[];
  projects: readonly { id: string; name: string }[];
  labels: readonly { name: string }[];
}

export interface Suggestion {
  /** What the row's value becomes — the name or key the condition matches. */
  value: string;
  label: string;
}

export const SUGGESTIONS_MAX = 8;

const distinct = (values: readonly (string | null | undefined)[]): Suggestion[] =>
  [...new Set(values.filter((value): value is string => value != null && value !== ""))].sort(COLLATOR.compare).map((value) => ({ value, label: value }));

/** The tasks a field points at — epics or parents — by key, named with their titles. */
function pointedAt(scope: SuggestionScope, ids: readonly (string | null | undefined)[]): Suggestion[] {
  const wanted = new Set(ids.filter((id): id is string => id != null));
  return scope.tasks.filter((task) => wanted.has(task.id)).map((task) => ({ value: task.key, label: `${task.key} ${task.title}` }));
}

/** Fields whose values already exist somewhere on the boards — offered to pick under the value field. */
export const SUGGESTED_FIELDS = ["labels", "project", "assignee", "flow", "worktree", "takenBy", "epic", "parent"] as const satisfies readonly QueryField[];
type SuggestedField = (typeof SUGGESTED_FIELDS)[number];

export const isSuggested = (field: QueryField): field is SuggestedField => (SUGGESTED_FIELDS as readonly QueryField[]).includes(field);

function candidates(field: SuggestedField, scope: SuggestionScope): Suggestion[] {
  switch (field) {
    case "labels":
      return distinct(scope.labels.map((label) => label.name));
    case "project":
      return distinct(scope.projects.map((project) => project.name));
    case "assignee":
      return distinct(scope.tasks.map((task) => task.assignee));
    case "flow":
      return distinct(scope.tasks.map((task) => task.flow?.name));
    case "worktree":
      return distinct([MAIN_CHECKOUT, ...scope.tasks.map(worktreeOf)]);
    case "takenBy":
      return distinct(scope.tasks.map((task) => task.takenBy?.machine));
    case "epic":
      return pointedAt(scope, [...scope.tasks.filter((task) => task.type === "epic").map((task) => task.id), ...scope.tasks.map((task) => task.epicId)]);
    case "parent":
      return pointedAt(scope, scope.tasks.map((task) => task.parentTaskId));
  }
}

/** The values of a field already on the boards that hold what is typed, case aside — no more than SUGGESTIONS_MAX. */
export function suggestionsOf(field: QueryField, scope: SuggestionScope, typed: string): Suggestion[] {
  if (!isSuggested(field)) return [];
  const needle = typed.trim().toLowerCase();
  return candidates(field, scope)
    .filter((entry) => entry.label.toLowerCase().includes(needle))
    .slice(0, SUGGESTIONS_MAX);
}

export { CONDITION_OP_SIGN, CONDITION_OPS, conditionsFromFilters, type ConditionOp, type TileCondition };
