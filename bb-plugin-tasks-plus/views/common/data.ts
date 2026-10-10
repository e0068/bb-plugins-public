import {
  listAllTasks,
  listTaskCardMeta,
  useTasksQuery,
} from "../../client/data.js";
import { isWorkingThread } from "../../shared/thread-activity.js";
import type {
  Label,
  Task,
  TaskPriority,
  TaskStatus,
  TaskThread,
} from "../../shared/contract.js";
import type { ListScope } from "./list-preference.js";

export interface ListTaskFilters {
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  /**
   * `null` means no label filter. An array (including empty) is an active
   * label filter: empty matches nothing once the catalog is known, which is
   * how stale/deleted label names recover without silently showing all tasks.
   */
  labelIds: readonly string[] | null;
}

/**
 * Server-side filtered task list, including subtasks. The list groups a
 * subtask under its parent's status (see `nestSubtasks`/`groupTasksByStatus`
 * in ./lib.js), so it must fetch both to render the tree.
 */
export function useListTasks(
  projectId: string | null,
  listScope: ListScope,
  filters: ListTaskFilters,
  /** Only the tasks this thread is attached to; undefined — every task of the scope. */
  thread: string | undefined,
) {
  return useTasksQuery(
    async (rpc) =>
      listAllTasks(rpc, {
        ...(projectId === null ? {} : { projectId }),
        ...(filters.statuses.length > 0
          ? { statuses: [...filters.statuses] }
          : {}),
        ...(filters.priorities.length > 0
          ? { priorities: [...filters.priorities] }
          : {}),
        ...(filters.labelIds !== null
          ? { labelIds: [...filters.labelIds] }
          : {}),
        ...(listScope === "active" ? { activeOnly: true } : {}),
        ...(listScope === "waiting" ? { waitingOnly: true } : {}),
        ...(thread === undefined ? {} : { threadId: thread }),
      }),
    ["tasks:changed", "threads:changed"],
    [
      projectId,
      listScope,
      filters.statuses.join(),
      filters.priorities.join(),
      filters.labelIds === null ? "" : `active:${filters.labelIds.join()}`,
      thread,
    ],
  );
}

/** Whether the server narrows the list: its filters or scope leave tasks out. */
export function narrowsOnServer(listScope: ListScope, filters: ListTaskFilters): boolean {
  return (
    listScope !== null ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.labelIds !== null
  );
}

/**
 * The tasks a list's rows read their place in the tree from — the epic and
 * everything under them. A list the server narrowed may leave the epic or
 * the finished work out, so it takes the scope's tasks unfiltered; otherwise
 * it is the list itself and nothing more is asked for.
 */
export function useTreeTasks(projectId: string | null, narrowed: boolean) {
  return useTasksQuery(
    async (rpc) => (narrowed ? listAllTasks(rpc, projectId === null ? {} : { projectId }) : null),
    ["tasks:changed"],
    [projectId, narrowed],
  );
}

/**
 * Labels for one or many projects. The contract only exposes per-project
 * listLabels, so cross-project routes fan out one call per project. (No shell
 * hook exists for labels; implemented locally per worker ownership rules.)
 */
export function useLabels(projectIds: readonly string[]) {
  return useTasksQuery<Label[]>(
    async (rpc) => {
      // One project's failure — its database out of reach — drops only its own labels.
      const results = await Promise.all(
        projectIds.map((projectId) =>
          rpc.call("listLabels", { projectId }).then(
            (result) => result.labels,
            () => [] as Label[],
          ),
        ),
      );
      return results.flat();
    },
    ["projects:changed"],
    [projectIds.join()],
  );
}

export interface TaskRowMeta {
  /** Threads currently starting or working. Historical attachments (idle,
   * completed, failed) are excluded — list rows only surface live activity. */
  activeThreads: TaskThread[];
  /** Files attached to the task — a field the table filters and sorts by. */
  attachmentCount: number;
}

/**
 * Live-activity metadata for list rows. Comments and attachments are detail-
 * view concerns and are deliberately not fetched here. One taskCardMeta call
 * for all rows: a listTaskThreads per row re-read the whole board per row
 * (BBPL-334).
 */
export function useTaskListMeta(tasks: readonly Task[] | undefined) {
  const taskIds = (tasks ?? []).map((task) => task.id);
  return useTasksQuery<Map<string, TaskRowMeta>>(
    async (rpc) => {
      const cards = await listTaskCardMeta(rpc, taskIds);
      return new Map(
        cards.map((card) => [
          card.taskId,
          { activeThreads: card.taskThreads.filter(isWorkingThread), attachmentCount: card.attachmentCount },
        ]),
      );
    },
    ["threads:changed", "tasks:changed"],
    [taskIds.join()],
  );
}
