// Pure core of `bb tasks epics migrate`: which epic tasks the board's epic
// folders turn into and which of their tasks move under them. The store
// (filesync/store.ts) carries the plan out; `--dry-run` prints it as is.
import type { TaskStatus } from "../db/types.js";
import type { Task } from "../shared/contract.js";

/** One epic folder `<assignee>/<name>/` and the epic task it becomes. */
export interface EpicFolderPlan {
  assignee: string;
  name: string;
  /** The new epic's status, read off its tasks. */
  status: TaskStatus;
  /** An epic task of that name and assignee made before — reused, not doubled. */
  existingId: string | null;
  /** Every task of the folder: each file moves up to the assignee's folder. */
  taskIds: string[];
  /** The tasks with no parent: they become the epic's children. A task with
   *  a parent keeps it, so no parent is lost. */
  childIds: string[];
}

/** Done when nothing is left to do, in progress once anything is moving, else to do. */
function epicStatus(tasks: readonly Task[]): TaskStatus {
  if (tasks.every((task) => task.status === "done" || task.status === "canceled")) return "done";
  if (tasks.some((task) => task.status === "in_progress" || task.status === "in_review")) return "in_progress";
  return "todo";
}

const folderKey = (assignee: string, name: string) => JSON.stringify([assignee, name]);

/** The plan for a board's tasks, folders in name order; empty once nothing lies in an epic folder. */
export function planMigration(tasks: readonly Task[]): EpicFolderPlan[] {
  const folders = tasks.reduce((groups, task) => {
    if (!task.assignee || !task.epic) return groups;
    const key = folderKey(task.assignee, task.epic);
    return groups.set(key, [...(groups.get(key) ?? []), task]);
  }, new Map<string, Task[]>());
  const epicByFolder = new Map(
    tasks
      .filter((task) => task.type === "epic" && task.assignee && !task.epic)
      .map((task) => [folderKey(task.assignee!, task.title), task.id]),
  );
  return [...folders.entries()]
    .map(([key, inFolder]): EpicFolderPlan => {
      const [assignee, name] = JSON.parse(key) as [string, string];
      return {
        assignee,
        name,
        status: epicStatus(inFolder),
        existingId: epicByFolder.get(key) ?? null,
        taskIds: inFolder.map((task) => task.id),
        childIds: inFolder.filter((task) => task.parentTaskId === null).map((task) => task.id),
      };
    })
    .sort((a, b) => a.assignee.localeCompare(b.assignee) || a.name.localeCompare(b.name));
}
