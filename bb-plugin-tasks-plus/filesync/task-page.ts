import type { Task, TaskStatus } from "../shared/contract.js";

/**
 * One page of a fully-read task list. The cursor is the offset of the next
 * page in that list: the file store reads every board anyway (see query.ts),
 * so the page only slices. A list changed between two pages may skip or
 * repeat a task by the ones added, removed or moved before the offset — the
 * price of not holding a snapshot between requests.
 */
export interface TaskPage {
  tasks: Task[];
  nextCursor: string | null;
}

/**
 * Which tasks a cross-project list carries first: the ones being worked on,
 * then the ones waiting to be, then the closed ones — so a list cut short by
 * its page still shows the live work of every board, not the history of the
 * first one. A single project's list keeps its manual order instead.
 */
const STATUS_RANK: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 0,
  in_review: 0,
  backlog: 1,
  done: 2,
  canceled: 2,
};

/** The list with live statuses first; within a rank, the board's own order stays (the sort is stable). */
export function byLiveStatusFirst(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

const OFFSET = /^(0|[1-9]\d*)$/;

/** A cursor this module gave out → its offset; anything else → undefined. */
export function parseTaskCursor(raw: string): number | undefined {
  return OFFSET.test(raw) ? Number(raw) : undefined;
}

/** The page at `offset` of the list as given, and the cursor of the next one while tasks remain. */
export function taskPage(tasks: readonly Task[], limit: number, offset = 0): TaskPage {
  const end = offset + limit;
  return {
    tasks: tasks.slice(offset, end),
    nextCursor: end < tasks.length ? String(end) : null,
  };
}
