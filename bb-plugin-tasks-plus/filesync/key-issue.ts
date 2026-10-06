/**
 * Which key each unnamed task of a board gets, as a pure function. A task
 * born in a branch lives without a key (BBPL-294); `bb tasks keys issue`
 * names it once the branch has caught up with main, so the numbers continue
 * after the largest one main already holds. filesync/store.ts writes the
 * result.
 */
import { nextTaskNumber } from "./board-config.js";

export interface IssuableTask {
  id: string;
  key: string;
  /** Null for a task the board has not named yet. */
  number: number | null;
  parentTaskId: string | null;
  createdAt: string;
}

export interface IssuedKey {
  id: string;
  key: string;
  number: number;
}

/**
 * The next free numbers of the board, one per unnamed task: parents before
 * their children — a child's `parent:` is written as the parent's key, so
 * the parent must have one first — and, at one depth, older tasks first.
 * A board with no unnamed task gets nothing, so a second run changes nothing.
 * `taken` — keys held elsewhere, out of the caller's sight: the board's
 * main checkout, where a task made on the board sits uncommitted.
 */
export function issueKeys(tasks: readonly IssuableTask[], prefix: string, taken: readonly string[] = []): IssuedKey[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  // The limit stops a parent loop written by hand from recursing forever.
  const depth = (task: IssuableTask, limit = tasks.length): number => {
    const parent = task.parentTaskId === null ? undefined : byId.get(task.parentTaskId);
    return parent === undefined || limit === 0 ? 0 : 1 + depth(parent, limit - 1);
  };
  const first = nextTaskNumber([...tasks.map((task) => task.key), ...taken], prefix);
  return tasks
    .filter((task) => task.number === null)
    .map((task) => ({ task, depth: depth(task) }))
    .sort((a, b) => a.depth - b.depth || a.task.createdAt.localeCompare(b.task.createdAt) || a.task.id.localeCompare(b.task.id))
    .map(({ task }, index) => ({ id: task.id, key: `${prefix}-${first + index}`, number: first + index }));
}
