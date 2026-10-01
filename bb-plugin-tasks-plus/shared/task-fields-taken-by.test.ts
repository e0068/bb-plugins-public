import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SavedViewFilters, Task } from "./contract.js";
import { EMPTY_FACTS, compareByField, matchesFieldFilters, type ColumnSort } from "./task-fields.js";

type TakenBy = import("./task-claim.js").TakenBy;

function task(number: number, takenBy: TakenBy | null = null): Task {
  return {
    id: `P1:task-${number}`,
    projectId: "P1",
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
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
    position: number,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    labelIds: [],
    source: null,
    takenBy,
  } as Task;
}

const mark = (machine: string): TakenBy => ({ machine, threadId: null, at: "2026-09-30T12:00:00.000Z" });

const NO_FILTERS: SavedViewFilters = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
  values: {},
  texts: {},
  dates: {},
  numbers: {},
};

const sortBy = (direction: "asc" | "desc", tasks: Task[]) =>
  [...tasks].sort(compareByField({ column: "takenBy", direction } as ColumnSort, EMPTY_FACTS)).map((t) => t.number);

describe("sorting by Taken by", () => {
  it("orders by machine name", () => {
    const tasks = [task(1, mark("studio")), task(2, mark("Mac mini")), task(3, mark("MacBook"))];
    expect(sortBy("asc", tasks)).toEqual([2, 3, 1]);
    expect(sortBy("desc", tasks)).toEqual([1, 3, 2]);
  });

  it("keeps tasks nobody took at the end, in both directions", () => {
    const machineArb = fc.option(fc.constantFrom("Mac mini", "MacBook", "studio"), { nil: null });
    fc.assert(
      fc.property(fc.array(machineArb, { maxLength: 10 }), fc.constantFrom("asc" as const, "desc" as const), (machines, direction) => {
        const tasks = machines.map((machine, index) => task(index + 1, machine === null ? null : mark(machine)));
        const order = sortBy(direction, tasks);
        const free = new Set(tasks.filter((t) => t.takenBy === null).map((t) => t.number));
        const firstFree = order.findIndex((n) => free.has(n));
        if (firstFree >= 0) expect(order.slice(firstFree).every((n) => free.has(n))).toBe(true);
        if (tasks.length > free.size) expect(firstFree === -1 || firstFree === tasks.length - free.size).toBe(true);
      }),
    );
  });
});

describe("filtering by Taken by", () => {
  it("keeps only the tasks the picked machine took", () => {
    const filters = { ...NO_FILTERS, values: { takenBy: ["Mac mini"] } } as SavedViewFilters;
    expect(matchesFieldFilters(task(1, mark("Mac mini")), filters, EMPTY_FACTS)).toBe(true);
    expect(matchesFieldFilters(task(2, mark("MacBook")), filters, EMPTY_FACTS)).toBe(false);
    expect(matchesFieldFilters(task(3), filters, EMPTY_FACTS)).toBe(false);
  });
});
