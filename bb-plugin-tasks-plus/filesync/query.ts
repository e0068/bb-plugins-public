import type { Task, TaskPriority, TaskStatus } from "../shared/contract.js";

/** In-memory filters over a fully-read task list — the file-backed
 *  replacement for the SQL store's `WHERE` clauses. There is no keyset
 *  pagination here: reading every file is cheap enough (see
 *  decisions/tasks-files-are-the-store.md) that the whole filtered,
 *  sorted list is always returned. */
export interface TaskFilters {
  statuses?: readonly TaskStatus[];
  priorities?: readonly TaskPriority[];
  labelIds?: readonly string[];
  parentTaskId?: string | null;
  search?: string;
  /** Task IDs with at least one thread currently starting/working (caller
   *  resolves this from live bb thread status). */
  activeTaskIds?: ReadonlySet<string>;
  /** Task IDs with at least one idle, unarchived thread. */
  waitingTaskIds?: ReadonlySet<string>;
}

function matchesSearch(task: Task, needle: string): boolean {
  const haystack = `${task.title} ${task.description} ${task.key}`.toLowerCase();
  return haystack.includes(needle);
}

/**
 * Filters a task list by every criterion given. Omitted filters pass
 * everything; an empty `statuses`/`priorities`/`labelIds` array matches
 * nothing (mirrors the SQL store's `listTasksPage`, where an empty IN-list is
 * `0 = 1`, not "no filter").
 */
export function filterTasks(
  tasks: readonly Task[],
  filters: TaskFilters,
): Task[] {
  const search = filters.search?.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filters.statuses && !filters.statuses.includes(task.status)) return false;
    if (filters.priorities && !filters.priorities.includes(task.priority)) {
      return false;
    }
    if (
      filters.labelIds &&
      !filters.labelIds.some((id) => task.labelIds.includes(id))
    ) {
      return false;
    }
    if (
      filters.parentTaskId !== undefined &&
      task.parentTaskId !== filters.parentTaskId
    ) {
      return false;
    }
    if (search && !matchesSearch(task, search)) return false;
    if (filters.activeTaskIds && !filters.activeTaskIds.has(task.id)) {
      return false;
    }
    if (filters.waitingTaskIds && !filters.waitingTaskIds.has(task.id)) {
      return false;
    }
    return true;
  });
}
