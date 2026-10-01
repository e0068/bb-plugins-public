import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { isRowFieldEmpty, planRowFields, type FieldPlanContext } from "./field-plan.js";
import type { FieldDisplayConfig, RowField } from "./row-field-preference.js";

const TAKEN_BY = "takenBy" as RowField;
const CTX: FieldPlanContext = { activeCount: 0, showProject: false, hasProject: false };

function task(takenBy: unknown): Task {
  return {
    id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    number: 1,
    key: "TSK-1",
    title: "T",
    description: "",
    status: "in_progress",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    labelIds: [],
    source: null,
    takenBy,
  } as Task;
}

const taken = task({ machine: "Mac mini", threadId: null, at: "2026-09-30T12:00:00.000Z" });

describe("an empty Taken by", () => {
  it("is empty while nobody took the task, and filled once somebody did", () => {
    expect(isRowFieldEmpty(TAKEN_BY, task(null), CTX)).toBe(true);
    expect(isRowFieldEmpty(TAKEN_BY, task(undefined), CTX)).toBe(true);
    expect(isRowFieldEmpty(TAKEN_BY, taken, CTX)).toBe(false);
  });

  it("is left out when Show empty is off, and drawn as a placeholder when it is on", () => {
    const config = (showEmpty: boolean) => ({ fields: [{ field: TAKEN_BY, visible: true }], showEmpty, showDescription: false }) as unknown as FieldDisplayConfig;
    expect(planRowFields(config(false), task(null), CTX)).toEqual([]);
    expect(planRowFields(config(true), task(null), CTX)).toEqual([{ field: TAKEN_BY, mode: "placeholder" }]);
    expect(planRowFields(config(false), taken, CTX)).toEqual([{ field: TAKEN_BY, mode: "value" }]);
  });
});
