import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BoardGrouping, SavedViewFilters, Task } from "../../shared/contract.js";
import { LIST_SORTS, QUERY_FIELDS } from "../../shared/enums.js";
import { compareByField, factsOf, viewSortColumn, type ViewSort } from "../../shared/task-fields.js";
import { matchesFilters } from "../../shared/task-fields.js";
import { boardColumns, canReorder } from "./grouping.js";

const NO_FILTERS: SavedViewFilters = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

function task(number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `P1:task-${number}`,
    projectId: "P1",
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: number,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    source: null,
    ...patch,
  };
}

const ungrouped: BoardGrouping = { groupBy: "none", columns: {}, hideEmpty: false };

const arbTask = fc
  .record({
    number: fc.integer({ min: 1, max: 30 }),
    title: fc.constantFrom("alpha", "Beta", "gamma"),
    priority: fc.constantFrom("urgent", "low", "none" as const),
    budget: fc.option(fc.integer({ min: 0, max: 9 }), { nil: null }),
    dueDate: fc.constantFrom(null, "2026-10-01", "2026-10-20"),
    flow: fc.constantFrom(null, { id: "a", name: "Code" }),
  })
  .map(({ number, ...patch }) => task(number, patch as Partial<Task>));

const FACTS = factsOf({ activeCounts: new Map([["P1:task-2", 1]]) });

describe("a board sorted and filtered by any field", () => {
  it("lays its cards out in the order the field and direction give", () => {
    fc.assert(
      fc.property(
        fc.array(arbTask, { maxLength: 10 }),
        fc.constantFrom(...QUERY_FIELDS),
        fc.constantFrom("asc" as const, "desc" as const),
        (tasks, column, direction) => {
          const cards = boardColumns(tasks, { filters: NO_FILTERS, sort: { column, direction }, grouping: ungrouped }, [], FACTS)[0]!.tasks;
          const compare = compareByField({ column, direction }, FACTS);
          cards.slice(1).forEach((card, index) => expect(compare(cards[index]!, card)).toBeLessThanOrEqual(0));
        },
      ),
    );
  });

  it("holds exactly the cards that pass the filter", () => {
    const filters: SavedViewFilters = {
      ...NO_FILTERS,
      values: { active: ["active"] },
      numbers: { budget: { from: 1, to: null, empty: true } },
    };
    fc.assert(
      fc.property(fc.array(arbTask, { maxLength: 10 }), (tasks) => {
        const cards = boardColumns(tasks, { filters, sort: "manual", grouping: ungrouped }, [], FACTS)[0]!.tasks;
        expect(cards).toEqual(tasks.filter((t) => matchesFilters(t, filters, [], new Set(), FACTS)));
      }),
    );
  });

  it("keeps the hand-set order only while unsorted, whichever way the sort was stored", () => {
    const sorts: ViewSort[] = [...LIST_SORTS, { column: "title", direction: "asc" }];
    for (const sort of sorts) {
      expect(canReorder("none", sort)).toBe(viewSortColumn(sort) === null);
    }
  });
});
