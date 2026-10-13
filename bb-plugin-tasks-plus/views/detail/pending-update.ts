import type { Task } from "../../shared/contract.js";
import { patchProperties, type PropertyPatch } from "../../shared/properties.js";
import type { TaskPropertyUpdate } from "./rail.js";

/**
 * The card shows a change the moment it is made: the write goes on in the
 * background, and until the server's copy of the task catches up the card
 * draws the server task with the changes still on their way laid over it.
 */

/** A change made in the card: its properties, title, description and record fields. */
export type DetailUpdate = TaskPropertyUpdate & { title?: string; description?: string; propertyPatch?: PropertyPatch };

/** The task as it is once `update` lands. */
export function withUpdate(task: Task, update: DetailUpdate): Task {
  const { propertyPatch, labelIds, ...fields } = update;
  const changed = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  return {
    ...task,
    ...changed,
    ...(labelIds === undefined ? {} : { labelIds: [...labelIds] }),
    ...(propertyPatch === undefined ? {} : { properties: patchProperties(task.properties ?? {}, propertyPatch) as Record<string, string> }),
  };
}

/** What the card draws: the last task a write answered with until the server's copy is newer, under the changes still on their way. */
export function shownTask(server: Task, answered: Task | undefined, pending: readonly DetailUpdate[]): Task {
  const base = answered !== undefined && answered.id === server.id && answered.updatedAt >= server.updatedAt ? answered : server;
  return pending.reduce(withUpdate, base);
}
