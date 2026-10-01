import { describe, expect, it } from "vitest";
import { taskSchema, tasksRpcContract } from "./contract.js";
import { LIST_SORTS, sortTasks } from "./sort.js";
import type { Task } from "./contract.js";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function task(key: string, startDate: string | null): Task {
  return {
    id: ULID,
    projectId: ULID,
    number: 1,
    key,
    title: "A task",
    description: "",
    status: "todo",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    startDate,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    labelIds: [],
    source: null,
  };
}

describe("task start date", () => {
  const base = {
    id: ULID,
    projectId: ULID,
    number: 1,
    key: "T-1",
    title: "A task",
    description: "",
    status: "todo",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    labelIds: [],
    source: null,
  };

  it("accepts an ISO calendar date", () => {
    expect(taskSchema.safeParse({ ...base, startDate: "2026-09-20" }).success).toBe(true);
  });

  it("accepts null", () => {
    expect(taskSchema.safeParse({ ...base, startDate: null }).success).toBe(true);
  });

  it("refuses a task with no start date field: the two plan dates are twins", () => {
    expect(taskSchema.safeParse(base).success).toBe(false);
  });

  it("rejects a day-first date", () => {
    expect(taskSchema.safeParse({ ...base, startDate: "20.09.2026" }).success).toBe(false);
  });

  it("rejects a date that is not on the calendar", () => {
    expect(taskSchema.safeParse({ ...base, startDate: "2026-02-31" }).success).toBe(false);
  });
});

describe("updateTask input with start date", () => {
  const schema = tasksRpcContract.updateTask.input;

  it("counts an edit that only sets the start date as non-empty", () => {
    const parsed = schema.safeParse({
      taskId: ULID,
      authorName: "agent",
      startDate: "2026-09-20",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts clearing the start date", () => {
    const parsed = schema.safeParse({
      taskId: ULID,
      authorName: "agent",
      startDate: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("sorting by start date", () => {
  it("offers start as a list sort", () => {
    expect(LIST_SORTS).toContain("start");
  });

  it("puts the earliest start first", () => {
    const sorted = sortTasks(
      [task("T-1", "2026-09-20"), task("T-2", "2026-09-10")],
      "start",
    );
    expect(sorted.map((t) => t.key)).toEqual(["T-2", "T-1"]);
  });

  it("puts tasks without a start date after every dated task", () => {
    const sorted = sortTasks(
      [task("T-1", null), task("T-2", "2026-09-10"), task("T-3", null)],
      "start",
    );
    expect(sorted.map((t) => t.key)).toEqual(["T-2", "T-1", "T-3"]);
  });

  it("keeps the input order when start dates are equal", () => {
    const sorted = sortTasks(
      [task("T-2", "2026-09-10"), task("T-1", "2026-09-10")],
      "start",
    );
    expect(sorted.map((t) => t.key)).toEqual(["T-2", "T-1"]);
  });
});
