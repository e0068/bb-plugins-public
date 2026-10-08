// Type-only: keeps the frontend bundle clear of contract.ts's runtime
// dependencies (zod, the server SDK), same as row-field-preference.ts.
import type { BoardGrouping, Label, Task } from "../../shared/contract.js";
import type { BoardGroupBy, BoardGroupProperty } from "../../shared/enums.js";
import { ALL_KEY, groupKeys, NONE_KEY } from "../board/grouping.js";
import { nestSubtasks } from "../common/lib.js";
import { compareByColumn, type ColumnSort, type SortContext } from "./columns.js";

/**
 * The pure core of the table's rows: the forest of tasks and sub-tasks, cut
 * into groups by a board-style property, ordered by a column sort within
 * each family, and folded by collapsed groups/tasks. No storage, no DOM —
 * the table view feeds this from its stored preferences and draws its
 * answer.
 */

export interface TableRow {
  task: Task;
  /** 0 for a group's root task, one more for each level under it. */
  depth: number;
  /** The task's direct children among the rows fed in — not all descendants. */
  childCount: number;
}

export interface TableGroup {
  key: string;
  /** `null` for the single group of an ungrouped table. */
  label: string | null;
  /** Every row that belongs to the group, whether or not it is folded away. */
  count: number;
  /** Folded by the viewer: its rows are left out, its header still shows. */
  collapsed: boolean;
  rows: TableRow[];
}

export interface RowsInput {
  groupBy: BoardGroupBy;
  sort: ColumnSort | null;
  context: SortContext;
  collapsedGroups: readonly string[];
  collapsedTasks: readonly string[];
  labels: readonly Label[];
}

/** A node of the rebuilt tree: a task, its depth, the root of its family, and its direct children. */
interface Node {
  task: Task;
  depth: number;
  root: Task;
  children: Node[];
}

/**
 * Rebuilds `nestSubtasks`'s flat pre-order forest into an explicit tree, so
 * a family can be sorted level by level without ever splitting it apart.
 * Depth rises by at most one per step in that order, so a simple depth
 * stack finds each entry's parent (the top of the stack once it is popped
 * back to the entry's depth) and, for depth 0, its own root.
 */
function buildForest(tasks: readonly Task[]): Node[] {
  const entries = nestSubtasks(tasks);
  const top: Node[] = [];
  const stack: Node[] = [];
  for (const entry of entries) {
    const root = entry.depth === 0 ? entry.task : stack[0]!.root;
    const node: Node = { task: entry.task, depth: entry.depth, root, children: [] };
    while (stack.length > entry.depth) stack.pop();
    const parent = stack.at(-1);
    if (parent === undefined) top.push(node);
    else parent.children.push(node);
    stack.push(node);
  }
  return top;
}

/** A node and everything under it, recursively. */
function familySize(node: Node): number {
  return 1 + node.children.reduce((sum, child) => sum + familySize(child), 0);
}

/** The node's rows in pre-order, its subtree left out once a collapsed task is reached. */
function flatten(node: Node, collapsedTasks: ReadonlySet<string>): TableRow[] {
  const row: TableRow = { task: node.task, depth: node.depth, childCount: node.children.length };
  if (collapsedTasks.has(node.task.id)) return [row];
  return [row, ...node.children.flatMap((child) => flatten(child, collapsedTasks))];
}

/** Sorts every level of the forest by the comparator, without ever mixing siblings from different parents. */
function sortForest(nodes: readonly Node[], compare: ((a: Task, b: Task) => number) | null): Node[] {
  const ordered = compare === null ? [...nodes] : [...nodes].sort((a, b) => compare(a.task, b.task));
  return ordered.map((node) => ({ ...node, children: sortForest(node.children, compare) }));
}

/**
 * A label-grouped task can carry several labels; it stands in the group of
 * whichever comes first in the groups' own order, or `NONE_KEY` when it
 * carries none of them.
 */
function labelGroupKey(task: Task, labels: readonly Label[], order: readonly string[]): string {
  const names = new Set(labels.filter((label) => task.labelIds.includes(label.id)).map((label) => label.name));
  return order.find((key) => names.has(key)) ?? NONE_KEY;
}

/** The one group key a family's root belongs to, for every groupable property. */
function rootGroupKey(root: Task, property: BoardGroupProperty, labels: readonly Label[], order: readonly string[]): string {
  switch (property) {
    case "status":
      return root.status;
    case "priority":
      return root.priority;
    case "type":
      return root.type ?? NONE_KEY;
    case "estimate":
      return root.estimate ?? NONE_KEY;
    case "assignee":
      return root.assignee ?? NONE_KEY;
    case "label":
      return labelGroupKey(root, labels, order);
  }
}

/**
 * The table's groups for a screen of tasks: each family (a root and its
 * nested sub-tasks) stands whole in the group of its root, groups follow
 * their property's canonical order and drop empty, sub-tasks sit right
 * under their parent one level deeper, and a sort — column, either
 * direction, empty last — orders siblings within each level without ever
 * splitting a family. A collapsed group keeps its total count but shows no
 * rows; a collapsed task keeps its own row but hides its subtree.
 */
export function tableRows(tasks: readonly Task[], input: RowsInput): TableGroup[] {
  if (tasks.length === 0) return [];

  const forest = sortForest(
    buildForest(tasks),
    input.sort === null ? null : compareByColumn(input.sort, input.context),
  );
  const collapsedTasks = new Set(input.collapsedTasks);
  const collapsedGroups = new Set(input.collapsedGroups);

  const { groupBy } = input;
  if (groupBy === "none") {
    const count = forest.reduce((sum, node) => sum + familySize(node), 0);
    const collapsed = collapsedGroups.has(ALL_KEY);
    return [
      {
        key: ALL_KEY,
        label: null,
        count,
        collapsed,
        rows: collapsed ? [] : forest.flatMap((node) => flatten(node, collapsedTasks)),
      },
    ];
  }

  const grouping: BoardGrouping = { groupBy, columns: {}, hideEmpty: false };
  const groups = groupKeys(grouping, tasks, input.labels);
  const order = groups.map((group) => group.key);
  const orderSet = new Set(order);

  const byKey = new Map<string, Node[]>();
  for (const node of forest) {
    const rawKey = rootGroupKey(node.root, groupBy, input.labels, order);
    // A root whose value points outside this screen — an epic that was
    // filtered out or deleted — has no column of its own; it still belongs
    // somewhere, so it falls into the group for an absent value.
    const key = orderSet.has(rawKey) ? rawKey : NONE_KEY;
    const bucket = byKey.get(key);
    if (bucket === undefined) byKey.set(key, [node]);
    else bucket.push(node);
  }

  return groups.flatMap((group) => {
    const nodes = byKey.get(group.key);
    if (nodes === undefined) return [];
    const count = nodes.reduce((sum, node) => sum + familySize(node), 0);
    const collapsed = collapsedGroups.has(group.key);
    return [
      {
        key: group.key,
        label: group.label,
        count,
        collapsed,
        rows: collapsed ? [] : nodes.flatMap((node) => flatten(node, collapsedTasks)),
      },
    ];
  });
}
