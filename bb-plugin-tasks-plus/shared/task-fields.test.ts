import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SavedViewFilters, Task } from "./contract.js";
import {
  DATE_FIELDS,
  LISTED_FILTER_KEYS,
  LIST_SORTS,
  NUMBER_FIELDS,
  QUERY_FIELDS,
  ROW_FIELDS,
  TEXT_FIELDS,
  VALUE_FILTER_FIELDS,
  WIDGET_FIELDS,
} from "./enums.js";
import {
  EMPTY_FACTS,
  compareByField,
  factsOf,
  fieldKind,
  filterTarget,
  matchesFieldFilters,
  viewSortColumn,
  type ColumnSort,
  type TaskFacts,
} from "./task-fields.js";

function task(overrides: Partial<Task> = {}): Task {
  const n = overrides.number ?? 1;
  return {
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
    ...overrides,
  } as Task;
}

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

const dayArb = fc
  .date({ min: new Date("2026-01-01T00:00:00Z"), max: new Date("2026-12-31T00:00:00Z"), noInvalidDate: true })
  .map((date) => date.toISOString().slice(0, 10));

const taskArb = fc
  .record({
    number: fc.integer({ min: 1, max: 99 }),
    title: fc.string({ maxLength: 8 }),
    description: fc.string({ maxLength: 12 }),
    status: fc.constantFrom("backlog", "todo", "in_progress", "in_review", "done", "canceled" as const),
    priority: fc.constantFrom("urgent", "high", "medium", "low", "none" as const),
    type: fc.constantFrom(null, "feature", "bugfix" as const),
    estimate: fc.constantFrom(null, "xs", "m", "xl" as const),
    budget: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
    cost: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
    dueDate: fc.option(dayArb, { nil: null }),
    startDate: fc.option(dayArb, { nil: null }),
    assignee: fc.constantFrom(null, "ana", "bo"),
    labelIds: fc.subarray(["L1", "L2"]),
    flow: fc.constantFrom(null, { id: "f1", name: "Code" }, { id: "f2", name: "Bug" }),
    parentTaskId: fc.constantFrom(null, "P1:task-1", "P1:task-2"),
    epicId: fc.constantFrom(null, "P1:task-1"),
    projectId: fc.constantFrom("P1", "P2"),
  })
  .map((fields) => task(fields as Partial<Task>));

const FACTS: TaskFacts = factsOf({
  projectNames: new Map([["P1", "Alpha"], ["P2", "beta"]]),
  taskKeys: new Map([["P1:task-1", "TSK-1"], ["P1:task-2", "TSK-2"]]),
  labelNames: new Map([["L1", "api"], ["L2", "ui"]]),
  activeCounts: new Map([["P1:task-3", 2]]),
  descendantCounts: new Map([["P1:task-4", 3]]),
  attachmentCounts: new Map([["P1:task-5", 1]]),
});

const queryFieldArb = fc.constantFrom(...QUERY_FIELDS);
const directionArb = fc.constantFrom("asc" as const, "desc" as const);

describe("the fields a filter and a sort offer", () => {
  it("are every row field but the card's widgets, in the canonical order", () => {
    expect(QUERY_FIELDS).toEqual(ROW_FIELDS.filter((field) => !(WIDGET_FIELDS as readonly string[]).includes(field)));
    expect(QUERY_FIELDS).toContain("flow");
  });

  it("each is in exactly the field list its filter kind names", () => {
    const lists = {
      listed: Object.keys(LISTED_FILTER_KEYS),
      values: VALUE_FILTER_FIELDS,
      text: TEXT_FIELDS,
      date: DATE_FIELDS,
      number: NUMBER_FIELDS,
    } as const;
    for (const field of QUERY_FIELDS) {
      const holding = Object.entries(lists).filter(([, list]) => (list as readonly string[]).includes(field));
      expect(holding.map(([kind]) => kind)).toEqual([fieldKind(field)]);
      expect(filterTarget(field)).toEqual({ kind: fieldKind(field), field });
    }
  });
});

describe("compareByField", () => {
  it("is antisymmetric for every field and direction", () => {
    fc.assert(
      fc.property(queryFieldArb, directionArb, taskArb, taskArb, (column, direction, a, b) => {
        const compare = compareByField({ column, direction }, FACTS);
        expect(Math.sign(compare(a, b)) + Math.sign(compare(b, a))).toBe(0);
      }),
    );
  });

  it("puts empty values last in both directions", () => {
    fc.assert(
      fc.property(fc.constantFrom("dueDate", "budget", "flow", "assignee", "labels", "parent") as fc.Arbitrary<ColumnSort["column"]>, directionArb, fc.array(taskArb, { maxLength: 12 }), (column, direction, tasks) => {
        const sorted = [...tasks].sort(compareByField({ column, direction }, FACTS));
        const empty = (t: Task) => compareByField({ column, direction }, FACTS)(t, task({ ...t, dueDate: null, budget: null, flow: null, assignee: null, labelIds: [], parentTaskId: null, epicId: null })) === 0;
        const firstEmpty = sorted.findIndex(empty);
        if (firstEmpty >= 0) expect(sorted.slice(firstEmpty).every(empty)).toBe(true);
      }),
    );
  });

  it("orders the fields that had no sort before", () => {
    const by = (sort: ColumnSort, tasks: Task[]) => [...tasks].sort(compareByField(sort, FACTS)).map((t) => t.number);
    expect(by({ column: "flow", direction: "asc" }, [task({ number: 1, flow: { id: "a", name: "Code" } }), task({ number: 2, flow: { id: "b", name: "bug" } }), task({ number: 3 })])).toEqual([2, 1, 3]);
    expect(by({ column: "labels", direction: "asc" }, [task({ number: 1, labelIds: ["L2"] }), task({ number: 2, labelIds: ["L2", "L1"] })])).toEqual([2, 1]);
    expect(by({ column: "parent", direction: "desc" }, [task({ number: 1, parentTaskId: "P1:task-1" }), task({ number: 2, parentTaskId: "P1:task-2" }), task({ number: 3 })])).toEqual([2, 1, 3]);
    expect(by({ column: "active", direction: "desc" }, [task({ number: 1 }), task({ number: 3 })])).toEqual([3, 1]);
    expect(by({ column: "subtasks", direction: "desc" }, [task({ number: 1 }), task({ number: 4 })])).toEqual([4, 1]);
    expect(by({ column: "attachments", direction: "desc" }, [task({ number: 1 }), task({ number: 5 })])).toEqual([5, 1]);
    expect(by({ column: "key", direction: "asc" }, [task({ number: 10 }), task({ number: 9 })])).toEqual([9, 10]);
    expect(
      by({ column: "worktree", direction: "asc" }, [
        task({ number: 1, source: { filePath: "a", origin: { kind: "worktree", environmentId: "e", name: null, branchName: "zeta" } } }),
        task({ number: 2, source: { filePath: "b", origin: { kind: "worktree", environmentId: "e", name: null, branchName: "alpha" } } }),
        task({ number: 3, source: { filePath: "c", origin: { kind: "main" } } }),
      ]),
    ).toEqual([2, 1, 3]);
    expect(by({ column: "description", direction: "asc" }, [task({ number: 1, description: "zeta" }), task({ number: 2, description: "Alpha" }), task({ number: 3 })])).toEqual([2, 1, 3]);
  });
});

describe("matchesFieldFilters", () => {
  it("lets any task through an empty filter", () => {
    fc.assert(fc.property(taskArb, (t) => matchesFieldFilters(t, NO_FILTERS, FACTS)));
  });

  it("lets any task through a range with no bounds and no empty mark", () => {
    const open = { from: null, to: null, empty: false };
    fc.assert(
      fc.property(taskArb, (t) => matchesFieldFilters(t, { ...NO_FILTERS, dates: { dueDate: open }, numbers: { budget: open } }, FACTS)),
    );
  });

  it("keeps a date within the range, bounds included", () => {
    const due = (from: string | null, to: string | null, empty = false) => ({ ...NO_FILTERS, dates: { dueDate: { from, to, empty } } });
    expect(matchesFieldFilters(task({ dueDate: "2026-10-01" }), due("2026-10-01", "2026-10-15"), FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ dueDate: "2026-10-15" }), due("2026-10-01", "2026-10-15"), FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ dueDate: "2026-10-16" }), due("2026-10-01", "2026-10-15"), FACTS)).toBe(false);
    expect(matchesFieldFilters(task({ dueDate: "2026-09-30" }), due("2026-10-01", null), FACTS)).toBe(false);
    expect(matchesFieldFilters(task({ dueDate: null }), due("2026-10-01", null), FACTS)).toBe(false);
    expect(matchesFieldFilters(task({ dueDate: null }), due("2026-10-01", null, true), FACTS)).toBe(true);
  });

  it("with only the empty mark keeps just the tasks without a value", () => {
    const noDue = { ...NO_FILTERS, dates: { dueDate: { from: null, to: null, empty: true } } };
    expect(matchesFieldFilters(task({ dueDate: null }), noDue, FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ dueDate: "2026-10-01" }), noDue, FACTS)).toBe(false);
  });

  it("reads a timestamp by its day", () => {
    const created = { ...NO_FILTERS, dates: { createdAt: { from: "2026-07-15", to: "2026-07-15", empty: false } } };
    expect(matchesFieldFilters(task({ createdAt: "2026-07-15T23:59:00.000Z" }), created, FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ createdAt: "2026-07-16T00:00:00.000Z" }), created, FACTS)).toBe(false);
  });

  it("keeps a number within the range, and a count as a number that is never empty", () => {
    const budget = { ...NO_FILTERS, numbers: { budget: { from: 5, to: 10, empty: false } } };
    expect(matchesFieldFilters(task({ budget: 5 }), budget, FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ budget: 10.5 }), budget, FACTS)).toBe(false);
    const noSubtasks = { ...NO_FILTERS, numbers: { subtasks: { from: 0, to: 0, empty: false } } };
    expect(matchesFieldFilters(task({ number: 1 }), noSubtasks, FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ number: 4 }), noSubtasks, FACTS)).toBe(false);
  });

  it("finds text regardless of case, in each text field", () => {
    const text = (field: (typeof TEXT_FIELDS)[number], needle: string) => ({ ...NO_FILTERS, texts: { [field]: needle } });
    const t = task({ number: 7, title: "Fix Login", description: "Steps\n\nThe token expires" });
    expect(matchesFieldFilters(t, text("title", "login"), FACTS)).toBe(true);
    expect(matchesFieldFilters(t, text("title", "logout"), FACTS)).toBe(false);
    expect(matchesFieldFilters(t, text("description", "TOKEN"), FACTS)).toBe(true);
    expect(matchesFieldFilters(t, text("key", "tsk-7"), FACTS)).toBe(true);
    expect(matchesFieldFilters(t, text("slug", "task-7"), FACTS)).toBe(true);
    expect(matchesFieldFilters(t, text("title", "   "), FACTS)).toBe(true);
  });

  it("keeps a task whose value is one of the picked ones", () => {
    const values = (picked: SavedViewFilters["values"]) => ({ ...NO_FILTERS, values: picked });
    expect(matchesFieldFilters(task({ projectId: "P2" }), values({ project: ["P1"] }), FACTS)).toBe(false);
    expect(matchesFieldFilters(task({ flow: { id: "f", name: "Code" } }), values({ flow: ["Code"] }), FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ number: 3 }), values({ active: ["active"] }), FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ number: 1 }), values({ active: ["active"] }), FACTS)).toBe(false);
    expect(matchesFieldFilters(task({ number: 1 }), values({ active: ["idle"] }), FACTS)).toBe(true);
    expect(matchesFieldFilters(task({ source: null }), values({ worktree: ["main"] }), FACTS)).toBe(true);
    expect(
      matchesFieldFilters(
        task({ source: { filePath: "a", origin: { kind: "worktree", environmentId: "e", name: null, branchName: "feat" } } }),
        values({ worktree: ["feat"] }),
        FACTS,
      ),
    ).toBe(true);
    expect(matchesFieldFilters(task({ projectId: "P2" }), values({ project: [] }), FACTS)).toBe(true);
  });
});

describe("viewSortColumn", () => {
  it("reads every legacy sort as a column sort, manual as unsorted", () => {
    for (const sort of LIST_SORTS) {
      const column = viewSortColumn(sort);
      if (sort === "manual") expect(column).toBeNull();
      else expect(QUERY_FIELDS).toContain(column!.column);
    }
    expect(viewSortColumn({ column: "title", direction: "desc" })).toEqual({ column: "title", direction: "desc" });
  });

  it("empty facts know nothing and break nothing", () => {
    fc.assert(
      fc.property(queryFieldArb, directionArb, taskArb, taskArb, (column, direction, a, b) => {
        expect(Number.isNaN(compareByField({ column, direction }, EMPTY_FACTS)(a, b))).toBe(false);
      }),
    );
  });
});
