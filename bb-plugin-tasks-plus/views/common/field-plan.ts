import type { Task } from "../../shared/contract.js";
import { firstParagraph } from "../../shared/first-paragraph.js";
import type { FieldDisplayConfig, RowField } from "./row-field-preference.js";

/**
 * Surface-independent signals a field's emptiness depends on beyond the task
 * itself. Both the list row and the board card compute these from their own
 * meta shape, so the plan below never touches a surface-specific meta type.
 */
export interface FieldPlanContext {
  /** Agents currently starting/working on the task. */
  activeCount: number;
  /** The surface shows a project swatch (cross-project list only). */
  showProject: boolean;
  /** The task's project is resolved (swatch has something to draw). */
  hasProject: boolean;
  /** Tasks under this one that count — at any depth, canceled left out; absent — none. */
  descendantCount?: number;
  /** Files attached to the task; absent — none. */
  attachmentCount?: number;
}

export type FieldCellMode = "value" | "placeholder";

export interface FieldPlanCell {
  field: RowField;
  mode: FieldCellMode;
}

/**
 * A field is empty when it has nothing worth a chip. `createdAt` and `updatedAt`
 * (shown as "Edited") are never empty — every task carries both timestamps;
 * `priority` counts "none" as empty so the rail is not littered with
 * "No priority".
 */
export function isRowFieldEmpty(
  field: RowField,
  task: Task,
  ctx: FieldPlanContext,
): boolean {
  switch (field) {
    case "title":
      return false;
    case "parent":
      return task.parentTaskId === null;
    case "attachments":
      return (ctx.attachmentCount ?? 0) === 0;
    case "worktree":
      return task.source?.origin.kind !== "worktree";
    case "description":
      return firstParagraph(task.description) === "";
    case "priority":
      return task.priority === "none";
    case "key":
    case "status":
    case "slug":
    // The card's sub-task list always carries Add sub-task, so a task gets its first from it.
    case "subtaskList":
      return false;
    case "subtasks":
    case "subtaskStats":
    case "burndown":
    case "gantt":
      return (ctx.descendantCount ?? 0) === 0;
    case "active":
      return ctx.activeCount === 0;
    case "assignee":
      return !task.assignee;
    case "flow":
      return !task.flow;
    case "takenBy":
      return !task.takenBy;
    case "type":
      return task.type === null;
    case "estimate":
      return task.estimate === null;
    case "labels":
      return task.labelIds.length === 0;
    case "plannedMinutes":
    case "actualMinutes":
    case "budget":
    case "budgetLimit":
    case "cost":
      return task[field] === null;
    case "dueDate":
      return task.dueDate === null;
    case "startDate":
      return task.startDate === null;
    case "project":
      return !ctx.showProject || !ctx.hasProject;
    case "createdAt":
    case "updatedAt":
      return false;
  }
}

/**
 * The ordered cells a surface should draw for one task: visible fields in the
 * configured order, empties dropped unless `showEmpty` turns them into a
 * placeholder. Rendering each cell (which chip, which icon) stays with the
 * surface; this only decides what appears and in what order.
 */
export function planRowFields(
  config: FieldDisplayConfig,
  task: Task,
  ctx: FieldPlanContext,
): FieldPlanCell[] {
  const cells: FieldPlanCell[] = [];
  for (const entry of config.fields) {
    if (!entry.visible) continue;
    if (!isRowFieldEmpty(entry.field, task, ctx)) {
      cells.push({ field: entry.field, mode: "value" });
    } else if (config.showEmpty) {
      cells.push({ field: entry.field, mode: "placeholder" });
    }
  }
  return cells;
}
