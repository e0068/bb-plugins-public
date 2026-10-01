import type { TaskType } from "./enums.js";

/** What finding a task's epic needs of it: its type and its parent. */
export interface EpicLink {
  id: string;
  type: TaskType | null;
  parentTaskId: string | null;
}

/**
 * The epic a task belongs to: its nearest ancestor typed epic, at any depth
 * and whatever lies between — the task's own type does not count, so an epic
 * inside an epic belongs to the outer one. Null when no ancestor is an epic;
 * a parent cycle in the data ends the walk instead of looping.
 */
export function nearestEpicId(taskId: string, byId: ReadonlyMap<string, EpicLink>): string | null {
  const climb = (parentId: string | null, seen: ReadonlySet<string>): string | null => {
    if (parentId === null || seen.has(parentId)) return null;
    const parent = byId.get(parentId);
    if (parent === undefined) return null;
    return parent.type === "epic" ? parent.id : climb(parent.parentTaskId, new Set(seen).add(parentId));
  };
  return climb(byId.get(taskId)?.parentTaskId ?? null, new Set([taskId]));
}
