// Layer: views, pure. A board card's footer data: the task's place in the tree
// comes from the task list itself, attachments and working agents from
// taskCardMeta, which arrives after the columns are drawn (BBPL-334).
import type { Task, TaskCardMeta, TaskThread } from "../../shared/contract.js";
import { familiesOf, progressOf, type SubtreeProgress, type TaskFamily } from "../../shared/subtree.js";
import { isWorkingThread } from "../../shared/thread-activity.js";

export interface BoardCardMeta {
  workingThreads: TaskThread[];
  attachmentCount: number;
  /** The task the card sits under, marked on a child's card. */
  parent: Task | null;
  /** The task's epic and everything under it, at any depth. */
  family: TaskFamily<Task>;
  /** Done out of the tasks under it. */
  progress: SubtreeProgress;
}

/** Meta for every task on the board; `cards` undefined — not loaded yet. */
export function boardCardMeta(
  tasks: readonly Task[],
  cards: readonly TaskCardMeta[] | undefined,
): Map<string, BoardCardMeta> {
  const families = familiesOf(tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const cardById = new Map((cards ?? []).map((card) => [card.taskId, card]));
  return new Map(
    tasks.map((task) => {
      const card = cardById.get(task.id);
      const family = families.get(task.id)!;
      return [
        task.id,
        {
          workingThreads: card?.taskThreads.filter(isWorkingThread) ?? [],
          attachmentCount: card?.attachmentCount ?? 0,
          parent: task.parentTaskId === null ? null : (byId.get(task.parentTaskId) ?? null),
          family,
          progress: progressOf(family.descendants),
        },
      ];
    }),
  );
}
