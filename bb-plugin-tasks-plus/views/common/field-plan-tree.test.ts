import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { isRowFieldEmpty, type FieldPlanContext } from "./field-plan.js";

const CTX: FieldPlanContext = { activeCount: 0, showProject: false, hasProject: false, descendantCount: 0 };
const task = { status: "todo", key: "TSK-1" } as Task;

describe("isRowFieldEmpty for the tree fields", () => {
  it("slug and status are never empty — every task has both", () => {
    expect(isRowFieldEmpty("slug", task, CTX)).toBe(false);
    expect(isRowFieldEmpty("status", task, CTX)).toBe(false);
  });

  it("sub-tasks are empty exactly when nothing lies under the task", () => {
    expect(isRowFieldEmpty("subtasks", task, CTX)).toBe(true);
    expect(isRowFieldEmpty("subtasks", task, { ...CTX, descendantCount: 2 })).toBe(false);
  });

  it("the sub-task list is never empty — its Add sub-task gives a task its first", () => {
    expect(isRowFieldEmpty("subtaskList", task, CTX)).toBe(false);
    expect(isRowFieldEmpty("subtaskList", task, { ...CTX, descendantCount: 2 })).toBe(false);
  });
});
