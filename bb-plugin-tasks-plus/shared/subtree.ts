import type { SubtaskScope, TaskStatus } from "./enums.js";

/** What walking the task tree needs of a task. */
export interface TreeLink {
  id: string;
  parentTaskId: string | null;
}

/** A task under another, `depth` levels down: 1 is a child, 2 a grandchild. */
export interface Descendant<T> {
  task: T;
  depth: number;
}

/**
 * Every task's descendants, each subtree right after its root and siblings
 * in the order they come in. A parent cycle in the data ends the walk, so no
 * task is listed under itself.
 */
export function descendantsOf<T extends TreeLink>(tasks: readonly T[]): Map<string, Descendant<T>[]> {
  const childrenOf = tasks.reduce((groups, task) => {
    if (task.parentTaskId === null) return groups;
    return groups.set(task.parentTaskId, [...(groups.get(task.parentTaskId) ?? []), task]);
  }, new Map<string, T[]>());
  const walk = (id: string, depth: number, seen: ReadonlySet<string>): Descendant<T>[] =>
    (childrenOf.get(id) ?? [])
      .filter((child) => !seen.has(child.id))
      .flatMap((child) => [{ task: child, depth }, ...walk(child.id, depth + 1, new Set(seen).add(child.id))]);
  return new Map(tasks.map((task) => [task.id, walk(task.id, 1, new Set([task.id]))]));
}

/**
 * The ids of the tasks lying under any of `rootIds`, at any depth — the roots
 * themselves only when one lies under another. Roots missing from `tasks`
 * have nothing under them.
 */
export function idsUnder(tasks: readonly TreeLink[], rootIds: readonly string[]): ReadonlySet<string> {
  if (rootIds.length === 0) return new Set();
  const descendants = descendantsOf(tasks);
  return new Set(rootIds.flatMap((rootId) => (descendants.get(rootId) ?? []).map(({ task }) => task.id)));
}

const isOpen = (status: TaskStatus) => status !== "done" && status !== "canceled";

/** The rows under the one at `index`: everything after it until the depth climbs back to its own. */
function subtreeAt<T>(rows: readonly Descendant<T>[], index: number): readonly Descendant<T>[] {
  const rest = rows.slice(index + 1);
  const end = rest.findIndex(({ depth }) => depth <= rows[index]!.depth);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The part of a subtree a sub-task list shows. "open" keeps a closed task
 * only as the parent of an open one, so every row still sits under its parent.
 */
export function subtasksInScope<T extends { status: TaskStatus }>(
  rows: readonly Descendant<T>[],
  scope: SubtaskScope,
): readonly Descendant<T>[] {
  switch (scope) {
    case "all":
      return rows;
    case "open-children":
      return rows.filter(({ task, depth }) => depth === 1 && isOpen(task.status));
    case "open":
      return rows.filter(
        ({ task }, index) => isOpen(task.status) || subtreeAt(rows, index).some((row) => isOpen(row.task.status)),
      );
  }
}

/** How far a subtree is: done out of the tasks that count, per status too. Canceled work is not work, so it counts in neither. */
export interface SubtreeProgress {
  done: number;
  total: number;
  byStatus: Record<TaskStatus, number>;
}

export function progressOf(descendants: readonly Descendant<{ status: TaskStatus }>[]): SubtreeProgress {
  const byStatus: Record<TaskStatus, number> = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 };
  const counted = descendants.reduce(
    (counts, { task }) => ({ ...counts, [task.status]: counts[task.status] + 1 }),
    byStatus,
  );
  return { done: counted.done, total: descendants.length - counted.canceled, byStatus: counted };
}

/** What a row or a card shows about a task's place in the tree. */
export interface TaskFamily<T> {
  descendants: Descendant<T>[];
}

/** Every task's family, from the whole list at once. */
export function familiesOf<T extends TreeLink>(tasks: readonly T[]): Map<string, TaskFamily<T>> {
  const descendants = descendantsOf(tasks);
  return new Map(tasks.map((task) => [task.id, { descendants: descendants.get(task.id) ?? [] }]));
}
