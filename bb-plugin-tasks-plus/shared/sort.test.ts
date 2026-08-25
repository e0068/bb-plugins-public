import { describe, expect, it } from "vitest";
import type { Task } from "./contract.js";
import { sortTasks } from "./sort.js";

const ULIDS = [
  "01ARZ3NDEKTSV4RRFFQ69G5FAA",
  "01ARZ3NDEKTSV4RRFFQ69G5FAB",
  "01ARZ3NDEKTSV4RRFFQ69G5FAC",
  "01ARZ3NDEKTSV4RRFFQ69G5FAD",
] as const;

function task(
  key: string,
  overrides: Partial<
    Pick<
      Task,
      "priority" | "dueDate" | "estimate" | "planTokens" | "factTokens"
    >
  > = {},
): Task {
  return {
    id: ULIDS[Number(key.split("-")[1]) - 1]!,
    projectId: ULIDS[0],
    number: 1,
    key,
    title: "A task",
    description: "",
    status: "todo",
    priority: "none",
    type: null,
    estimate: null,
    planTokens: null,
    factTokens: null,
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    labelIds: [],
    checks: [],
    ...overrides,
  };
}

const keys = (tasks: readonly Task[]) => tasks.map((t) => t.key);

describe("sortTasks", () => {
  it("keeps the server order for manual without mutating the input", () => {
    const input = [task("T-2"), task("T-1")];
    const sorted = sortTasks(input, "manual");
    expect(keys(sorted)).toEqual(["T-2", "T-1"]);
    expect(sorted).not.toBe(input);
  });

  it("orders estimate largest → smallest with none last", () => {
    const sorted = sortTasks(
      [
        task("T-1", { estimate: "s" }),
        task("T-2", { estimate: null }),
        task("T-3", { estimate: "xl" }),
        task("T-4", { estimate: "m" }),
      ],
      "estimate",
    );
    expect(keys(sorted)).toEqual(["T-3", "T-4", "T-1", "T-2"]);
  });

  it("orders plan tokens highest first with missing values last", () => {
    const sorted = sortTasks(
      [
        task("T-1", { planTokens: 100 }),
        task("T-2", { planTokens: null }),
        task("T-3", { planTokens: 500 }),
        task("T-4", { planTokens: 250 }),
      ],
      "plan_tokens",
    );
    expect(keys(sorted)).toEqual(["T-3", "T-4", "T-1", "T-2"]);
  });

  it("orders fact tokens independently of plan tokens", () => {
    const sorted = sortTasks(
      [
        task("T-1", { factTokens: 10 }),
        task("T-2", { factTokens: 90 }),
      ],
      "fact_tokens",
    );
    expect(keys(sorted)).toEqual(["T-2", "T-1"]);
  });

  it("orders priority urgent → none with due date breaking ties", () => {
    const sorted = sortTasks(
      [
        task("T-1", { priority: "none" }),
        task("T-2", { priority: "high", dueDate: "2026-08-01" }),
        task("T-3", { priority: "high", dueDate: "2026-07-20" }),
        task("T-4", { priority: "urgent" }),
      ],
      "priority",
    );
    expect(keys(sorted)).toEqual(["T-4", "T-3", "T-2", "T-1"]);
  });

  it("orders due dates soonest first, undated last, priority breaking ties", () => {
    const sorted = sortTasks(
      [
        task("T-1", { dueDate: null, priority: "urgent" }),
        task("T-2", { dueDate: "2026-07-20", priority: "low" }),
        task("T-3", { dueDate: "2026-07-20", priority: "high" }),
        task("T-4", { dueDate: "2026-07-18" }),
      ],
      "due",
    );
    expect(keys(sorted)).toEqual(["T-4", "T-3", "T-2", "T-1"]);
  });

  it("preserves the incoming order when all sort keys tie", () => {
    const input = [
      task("T-3", { priority: "high" }),
      task("T-1", { priority: "high" }),
      task("T-2", { priority: "high" }),
    ];
    expect(keys(sortTasks(input, "priority"))).toEqual(["T-3", "T-1", "T-2"]);
    expect(keys(sortTasks(input, "due"))).toEqual(["T-3", "T-1", "T-2"]);
  });
});
