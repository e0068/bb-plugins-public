import type { Task } from "../../shared/contract.js";
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
    case "priority":
      return task.priority === "none";
    case "active":
      return ctx.activeCount === 0;
    case "type":
      return task.type === null;
    case "estimate":
      return task.estimate === null;
    case "labels":
      return task.labelIds.length === 0;
    case "tokens":
      return task.planTokens === null && task.factTokens === null;
    case "dueDate":
      return task.dueDate === null;
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
