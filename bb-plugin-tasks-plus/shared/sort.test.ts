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
      | "priority"
      | "dueDate"
      | "estimate"
      | "plannedMinutes"
      | "actualMinutes"
      | "budget"
      | "budgetLimit"
      | "cost"
      | "createdAt"
      | "updatedAt"
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

  it("orders planned time highest first with missing values last", () => {
    const sorted = sortTasks(
      [
        task("T-1", { plannedMinutes: 30 }),
        task("T-2", { plannedMinutes: null }),
        task("T-3", { plannedMinutes: 240 }),
        task("T-4", { plannedMinutes: 90 }),
      ],
      "planned_minutes",
    );
    expect(keys(sorted)).toEqual(["T-3", "T-4", "T-1", "T-2"]);
  });

  it.each([
    ["actual_minutes", "actualMinutes"],
    ["budget", "budget"],
    ["budget_limit", "budgetLimit"],
    ["cost", "cost"],
  ] as const)("orders %s by its own field, highest first, missing last", (sort, field) => {
    const sorted = sortTasks(
      [
        task("T-1", { [field]: 10.5 }),
        task("T-2", { [field]: null }),
        task("T-3", { [field]: 90 }),
      ],
      sort,
    );
    expect(keys(sorted)).toEqual(["T-3", "T-1", "T-2"]);
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

  it("orders created newest first", () => {
    const sorted = sortTasks(
      [
        task("T-1", { createdAt: "2026-07-01T00:00:00.000Z" }),
        task("T-2", { createdAt: "2026-07-03T00:00:00.000Z" }),
        task("T-3", { createdAt: "2026-07-02T00:00:00.000Z" }),
      ],
      "created",
    );
    expect(keys(sorted)).toEqual(["T-2", "T-3", "T-1"]);
  });

  it("orders updated newest first, independently of created", () => {
    const sorted = sortTasks(
      [
        task("T-1", {
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
        }),
        task("T-2", {
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-20T09:30:00.000Z",
        }),
      ],
      "updated",
    );
    expect(keys(sorted)).toEqual(["T-2", "T-1"]);
  });

  it("separates timestamps within the same day", () => {
    const sorted = sortTasks(
      [
        task("T-1", { updatedAt: "2026-07-10T08:00:00.000Z" }),
        task("T-2", { updatedAt: "2026-07-10T19:45:00.000Z" }),
      ],
      "updated",
    );
    expect(keys(sorted)).toEqual(["T-2", "T-1"]);
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
