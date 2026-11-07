import { describe, expect, it } from "vitest";
import type { SavedViewFilters, Task } from "./contract.js";
import { QUERY_FIELDS, TEXT_FIELDS } from "./enums.js";
import { EMPTY_FACTS, compareByField, factsOf, fieldKind, matchesFieldFilters } from "./task-fields.js";

const task = (n: number): Task =>
  ({
    id: `P1:task-${n}`,
    projectId: "P1",
    number: n,
    key: `TSK-${n}`,
    title: `Task ${n}`,
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
    startDate: null,
    parentTaskId: null,
    position: n,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    source: null,
  }) as Task;

const FILTERS: SavedViewFilters = {
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

const FACTS = factsOf({
  threadTitles: new Map([
    ["P1:task-1", ["Zeta fix", "Alpha pass"]],
    ["P1:task-2", ["Beta"]],
  ]),
});

describe("the Assignee field — the threads attached to a task", () => {
  it("is a query field filtered by contained text", () => {
    expect(QUERY_FIELDS).toContain("threads");
    expect(fieldKind("threads")).toBe("text");
    expect(TEXT_FIELDS[TEXT_FIELDS.length - 1]).toBe("threads");
  });

  it("filters by any of a task's thread titles, case aside", () => {
    const filters = { ...FILTERS, texts: { threads: "alpha" } };
    expect(matchesFieldFilters(task(1), filters, FACTS)).toBe(true);
    expect(matchesFieldFilters(task(2), filters, FACTS)).toBe(false);
    expect(matchesFieldFilters(task(3), filters, FACTS)).toBe(false);
  });

  it("sorts by the titles joined by a comma, a task with no thread last both ways", () => {
    const order = (direction: "asc" | "desc") =>
      [task(3), task(2), task(1)].sort(compareByField({ column: "threads", direction }, FACTS)).map((t) => t.number);
    expect(order("asc")).toEqual([2, 1, 3]);
    expect(order("desc")).toEqual([1, 2, 3]);
  });

  it("reads as empty when the surface supplies no thread titles", () => {
    expect(compareByField({ column: "threads", direction: "asc" }, EMPTY_FACTS)(task(1), task(2))).toBe(0);
  });
});
