// Type-only: keeps the frontend bundle clear of contract.ts's runtime
// dependencies (zod, the server SDK).
import type {
  BoardGrouping,
  Label,
  SavedViewFilters,
  Task,
} from "../../shared/contract.js";
import {
  BOARD_COLUMN_WIDTH,
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type BoardGridColumns,
  type BoardGroupBy,
  type BoardGroupProperty,
  type TaskStatus,
} from "../../shared/enums.js";
import { sortTasks } from "../../shared/sort.js";
import {
  EMPTY_FACTS,
  viewSortColumn,
  type TaskFacts,
  type ViewSort,
} from "../../shared/task-fields.js";
import { moveInOrder } from "../../shared/manual-order.js";
import { descendantsOf, idsUnder } from "../../shared/subtree.js";
import {
  ESTIMATE_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
} from "../../components/task-meta.js";
import { matchesFilters } from "../common/optimistic.js";

/**
 * The pure core of the board: which columns it draws for a grouping, which
 * cards each holds, and what a card dropped into another column changes.
 * No storage, no RPC — the view and the toolbar feed it and act on its answer.
 */

/** Everything the board's layout is made of besides the card fields. */
export interface BoardLayout {
  filters: SavedViewFilters;
  sort: ViewSort;
  grouping: BoardGrouping;
}

export interface BoardColumn {
  /** The property's value, a label or folder name, "none", or "all" when ungrouped. */
  key: string;
  label: string;
  tasks: Task[];
}

/** Columns of the ungrouped grid; a grouping saved before the choice lays them out on auto. */
export const gridColumnsOf = (grouping: BoardGrouping): BoardGridColumns => grouping.gridColumns ?? "auto";

/** The key of the empty value's column: no type, no label, no assignee… */
export const NONE_KEY = "none";
/** The one column of an ungrouped board. */
export const ALL_KEY = "all";

const NONE_LABELS: Record<BoardGroupProperty, string> = {
  status: "No status",
  priority: PRIORITY_LABELS.none,
  type: "No type",
  estimate: "No estimate",
  assignee: "No assignee",
  epic: "No epic",
  label: "No label",
};

const labelNamesOf = (task: Task, labels: readonly Label[]): string[] =>
  labels.filter((label) => task.labelIds.includes(label.id)).map((label) => label.name);

/** The column keys a task belongs to — one, except a task with several labels. */
function keysOf(task: Task, property: BoardGroupProperty, labels: readonly Label[]): string[] {
  switch (property) {
    case "status":
      return [task.status];
    case "priority":
      return [task.priority];
    case "type":
      return [task.type ?? NONE_KEY];
    case "estimate":
      return [task.estimate ?? NONE_KEY];
    case "assignee":
      return [task.assignee ?? NONE_KEY];
    case "epic":
      return [task.epicId ?? NONE_KEY];
    case "label": {
      const names = labelNamesOf(task, labels);
      return names.length > 0 ? names : [NONE_KEY];
    }
  }
}

/** Assignee names the tasks use, sorted — columns and filter options alike. */
export const namesInUse = (tasks: readonly Task[], pick: (task: Task) => string | null | undefined) =>
  [...new Set(tasks.flatMap((task) => pick(task) ?? []))].sort((a, b) => a.localeCompare(b));

/** Every column the property can have on this board, in its natural order. */
function naturalKeys(
  property: BoardGroupProperty,
  tasks: readonly Task[],
  labels: readonly Label[],
): string[] {
  switch (property) {
    case "status":
      return [...TASK_STATUSES];
    case "priority":
      return [...TASK_PRIORITIES];
    case "type":
      return [...TASK_TYPES, NONE_KEY];
    case "estimate":
      return [...TASK_ESTIMATES, NONE_KEY];
    case "assignee":
      return [...namesInUse(tasks, (task) => task.assignee), NONE_KEY];
    case "epic":
      return [...tasks.filter((task) => task.type === "epic").map((task) => task.id), NONE_KEY];
    case "label":
      return [...new Set(labels.map((label) => label.name)), NONE_KEY];
  }
}

/** An epic column reads as its epic task does elsewhere: key and title. */
function epicLabel(key: string, tasks: readonly Task[]): string {
  const epic = tasks.find((task) => task.id === key);
  return epic === undefined ? key : `${epic.key} ${epic.title}`;
}

function columnLabel(property: BoardGroupProperty, key: string, tasks: readonly Task[]): string {
  if (key === NONE_KEY && property !== "priority") return NONE_LABELS[property];
  switch (property) {
    case "status":
      return STATUS_LABELS[key as TaskStatus];
    case "priority":
      return PRIORITY_LABELS[key as Task["priority"]];
    case "type":
      return TYPE_LABELS[key as NonNullable<Task["type"]>];
    case "estimate":
      return ESTIMATE_LABELS[key as NonNullable<Task["estimate"]>];
    case "epic":
      return epicLabel(key, tasks);
    case "assignee":
    case "label":
      return key;
  }
}

/** The owner's order first — only keys that are columns — then the rest in natural order. */
const ordered = (natural: readonly string[], order: readonly string[]) => [
  ...order.filter((key) => natural.includes(key)),
  ...natural.filter((key) => !order.includes(key)),
];

/** The filter on the grouped property itself, as column keys; empty when there is none. */
function filteredKeys(property: BoardGroupProperty, filters: SavedViewFilters): readonly string[] {
  switch (property) {
    case "status":
      return filters.statuses;
    case "priority":
      return filters.priorities;
    case "type":
      return filters.types;
    case "estimate":
      return filters.estimates;
    case "assignee":
      return filters.assignees;
    case "epic":
      // No filter narrows the epics themselves; the parent filter narrows the tasks.
      return [];
    case "label":
      return filters.labelNames;
  }
}

function passingTasks(
  tasks: readonly Task[],
  filters: SavedViewFilters,
  labels: readonly Label[],
  facts: TaskFacts,
): Task[] {
  const labelIds = labels
    .filter((label) => filters.labelNames.includes(label.name))
    .map((label) => label.id);
  // A label filter naming no label of this project matches nothing, not everything.
  if (filters.labelNames.length > 0 && labelIds.length === 0) return [];
  const underParents = idsUnder(tasks, filters.parents);
  return tasks.filter((task) => matchesFilters(task, filters, labelIds, underParents, facts));
}

/**
 * The board's columns for a layout. Filters and the sort apply to the cards;
 * the grouping picks the columns: the owner's order, minus hidden ones, minus
 * empty ones when asked, minus those a filter on the same property excludes.
 * Canceled stays off a status board while it holds nothing, as it always did.
 */
export function boardColumns(
  tasks: readonly Task[],
  layout: BoardLayout,
  labels: readonly Label[],
  facts: TaskFacts = EMPTY_FACTS,
): BoardColumn[] {
  const cards = sortTasks(passingTasks(tasks, layout.filters, labels, facts), layout.sort, facts);
  const property = layout.grouping.groupBy;
  if (property === "none") return [{ key: ALL_KEY, label: "All tasks", tasks: cards }];

  const settings = layout.grouping.columns[property];
  const onlyKeys = filteredKeys(property, layout.filters);
  return ordered(naturalKeys(property, tasks, labels), settings?.order ?? [])
    .filter((key) => !(settings?.hidden ?? []).includes(key))
    .filter((key) => onlyKeys.length === 0 || onlyKeys.includes(key))
    .map((key) => ({
      key,
      label: columnLabel(property, key, tasks),
      tasks: cards.filter((task) => keysOf(task, property, labels).includes(key)),
    }))
    .filter((column) => column.tasks.length > 0 || !layout.grouping.hideEmpty)
    .filter((column) => column.tasks.length > 0 || !(property === "status" && column.key === "canceled"));
}

/** The fields a drop can set — the groupable properties besides status. */
export interface GroupPatch {
  priority?: Task["priority"];
  type?: Task["type"];
  estimate?: Task["estimate"];
  assignee?: string | null;
  /** A drop into an epic's column puts the task under the epic. */
  parentTaskId?: string | null;
  labelIds?: string[];
}

/** What a card dropped from one column into another asks the server to change. */
export type DropChange =
  | { kind: "none" }
  | { kind: "status"; status: TaskStatus }
  | { kind: "patch"; patch: GroupPatch };

const NO_CHANGE: DropChange = { kind: "none" };

const oneOf = <T extends string>(values: readonly T[], key: string): key is T =>
  (values as readonly string[]).includes(key);

/** A nullable property's value for a column key: "none" clears it. */
function nullableValue<T extends string>(values: readonly T[], key: string): T | null | undefined {
  if (key === NONE_KEY) return null;
  return oneOf(values, key) ? key : undefined;
}

function labelDrop(task: Task, fromKey: string, toKey: string, labels: readonly Label[]): DropChange {
  const idOf = (name: string) => labels.find((label) => label.name === name)?.id;
  const toId = toKey === NONE_KEY ? null : idOf(toKey);
  if (toId === undefined) return NO_CHANGE;
  const fromId = fromKey === NONE_KEY ? null : idOf(fromKey);
  const kept = task.labelIds.filter((id) => id !== fromId);
  const labelIds = toId === null || kept.includes(toId) ? kept : [...kept, toId];
  return { kind: "patch", patch: { labelIds } };
}

/**
 * The change a drop makes: the grouped property takes the target column's
 * value. A label is swapped — the source column's label for the target's —
 * so a card with two labels keeps the other one. A key that is no value of
 * the property changes nothing.
 */
export function dropPatch(
  task: Task,
  groupBy: BoardGroupBy,
  fromKey: string,
  toKey: string,
  labels: readonly Label[],
): DropChange {
  if (fromKey === toKey) return NO_CHANGE;
  const patchWith = (patch: GroupPatch | undefined): DropChange =>
    patch === undefined ? NO_CHANGE : { kind: "patch", patch };
  const nullable = <T extends string>(values: readonly T[], build: (value: T | null) => GroupPatch) => {
    const value = nullableValue(values, toKey);
    return patchWith(value === undefined ? undefined : build(value));
  };
  switch (groupBy) {
    case "none":
      return NO_CHANGE;
    case "status":
      return oneOf(TASK_STATUSES, toKey) ? { kind: "status", status: toKey } : NO_CHANGE;
    case "priority":
      return patchWith(oneOf(TASK_PRIORITIES, toKey) ? { priority: toKey } : undefined);
    case "type":
      return nullable(TASK_TYPES, (type) => ({ type }));
    case "estimate":
      return nullable(TASK_ESTIMATES, (estimate) => ({ estimate }));
    case "assignee":
      return patchWith({ assignee: toKey === NONE_KEY ? null : toKey });
    case "epic":
      return patchWith({ parentTaskId: toKey === NONE_KEY ? null : toKey });
    case "label":
      return labelDrop(task, fromKey, toKey, labels);
  }
}

/**
 * Whether dropping a card into an epic's column would put the task under
 * itself: the column is the task's own, or an epic that lies under it. The
 * server refuses that parent; the board does not ask.
 */
export function dropsUnderItself(task: Task, toKey: string, tasks: readonly Task[]): boolean {
  if (toKey === task.id) return true;
  return (descendantsOf(tasks).get(task.id) ?? []).some(({ task: under }) => under.id === toKey);
}

/**
 * Cards keep the project's hand-set order in status columns and in the
 * ungrouped grid, while no sort overrides it; other groupings sort their
 * columns by property, so a drop there only changes the property.
 */
export const canReorder = (groupBy: BoardGroupBy, sort: ViewSort): boolean =>
  (groupBy === "status" || groupBy === "none") && viewSortColumn(sort) === null;

// ——— column settings: pure updaters the toolbar and the view call ———

const EMPTY_SETTINGS = { order: [], hidden: [], widths: {} };

function withSettings(
  grouping: BoardGrouping,
  update: (settings: NonNullable<BoardGrouping["columns"][BoardGroupProperty]>) => NonNullable<
    BoardGrouping["columns"][BoardGroupProperty]
  >,
): BoardGrouping {
  const property = grouping.groupBy;
  if (property === "none") return grouping;
  return {
    ...grouping,
    columns: {
      ...grouping.columns,
      [property]: update(grouping.columns[property] ?? EMPTY_SETTINGS),
    },
  };
}

/** A dragged width held inside the allowed range, in whole pixels. */
export const clampWidth = (width: number) =>
  Math.round(Math.min(BOARD_COLUMN_WIDTH.max, Math.max(BOARD_COLUMN_WIDTH.min, width)));

export function columnWidth(grouping: BoardGrouping, key: string): number {
  const property = grouping.groupBy;
  if (property === "none") return BOARD_COLUMN_WIDTH.initial;
  return grouping.columns[property]?.widths[key] ?? BOARD_COLUMN_WIDTH.initial;
}

export const withColumnWidth = (grouping: BoardGrouping, key: string, width: number) =>
  withSettings(grouping, (settings) => ({
    ...settings,
    widths: { ...settings.widths, [key]: clampWidth(width) },
  }));

export const withHiddenToggled = (grouping: BoardGrouping, key: string) =>
  withSettings(grouping, (settings) => ({
    ...settings,
    hidden: settings.hidden.includes(key)
      ? settings.hidden.filter((hidden) => hidden !== key)
      : [...settings.hidden, key],
  }));

export const withColumnOrder = (grouping: BoardGrouping, order: readonly string[]) =>
  withSettings(grouping, (settings) => ({ ...settings, order: [...order] }));

/**
 * Every column key of the grouped property, hidden ones included, in the
 * owner's order — what the Group menu lists for reordering and hiding.
 */
export function groupKeys(
  grouping: BoardGrouping,
  tasks: readonly Task[],
  labels: readonly Label[],
): { key: string; label: string; hidden: boolean }[] {
  const property = grouping.groupBy;
  if (property === "none") return [];
  const settings = grouping.columns[property];
  return ordered(naturalKeys(property, tasks, labels), settings?.order ?? []).map((key) => ({
    key,
    label: columnLabel(property, key, tasks),
    hidden: (settings?.hidden ?? []).includes(key),
  }));
}

/** The board's tasks with a drop's change applied to one card — the optimistic view. */
export function withDrop(tasks: readonly Task[], taskId: string, change: DropChange): Task[] {
  switch (change.kind) {
    case "none":
      return [...tasks];
    case "status":
      return tasks.map((task) => (task.id === taskId ? { ...task, status: change.status } : task));
    case "patch": {
      // A drop into an epic's column makes that epic the parent — and so the
      // task's nearest epic, until the server says so itself.
      const epic = change.patch.parentTaskId === undefined ? {} : { epicId: change.patch.parentTaskId };
      return tasks.map((task) => (task.id === taskId ? { ...task, ...change.patch, ...epic } : task));
    }
  }
}

/**
 * The tasks with one card moved right before `nextTaskId`, or to the end
 * when nothing follows it — how a hand-reordered column or grid is drawn
 * before the server answers, by the same rule the server keeps the order
 * with (shared/manual-order.ts).
 */
export function placedBefore(
  tasks: readonly Task[],
  taskId: string,
  nextTaskId: string | null,
): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (!byId.has(taskId)) return [...tasks];
  return moveInOrder([...byId.keys()], taskId, { beforeTaskId: null, afterTaskId: nextTaskId }).map(
    (id) => byId.get(id)!,
  );
}
