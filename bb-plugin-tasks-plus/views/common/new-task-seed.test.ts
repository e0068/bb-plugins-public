// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Label, Task } from "../../shared/contract.js";
import {
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from "../../shared/enums.js";
import type { ListFilterState } from "./filter-state.js";
import { EMPTY_SEED, labelIdsByName, newTaskSeed } from "./new-task-seed.js";
import { matchesFilters } from "./optimistic.js";

const PROJECT = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const OTHER = "01HZZZZZZZZZZZZZZZZZZZZZP2";

const NO_FILTERS: ListFilterState = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

function filters(patch: Partial<ListFilterState>): ListFilterState {
  return { ...NO_FILTERS, ...patch };
}


const NAMES = ["alice", "bob", "carol"];
const subset = <T,>(values: readonly T[]) =>
  fc.uniqueArray(fc.constantFrom(...values), { maxLength: values.length });

const filtersArb = fc.record({
  statuses: subset(TASK_STATUSES),
  priorities: subset(TASK_PRIORITIES),
  types: subset(TASK_TYPES),
  estimates: subset(TASK_ESTIMATES),
  labelNames: subset(["bug", "ui", "docs"]),
  assignees: subset(NAMES),
  parents: subset(["P1:alpha", "P1:beta"]),
});

const tasksArb = fc.array(
  fc.record({
    assignee: fc.option(fc.constantFrom(...NAMES), { nil: null }),
    epic: fc.option(fc.constantFrom("alpha", "beta"), { nil: null }),
  }),
  { maxLength: 6 },
);

describe("newTaskSeed", () => {
  it("keeps the usual value when the filter allows it", () => {
    const seed = newTaskSeed(
      null,
      filters({ statuses: ["in_progress", "todo", "backlog"], priorities: ["high", "none"] }),
    );
    expect(seed.status).toBe("todo");
    expect(seed.priority).toBe("none");
  });

  it("takes the filter's first value when the usual one is filtered out", () => {
    const seed = newTaskSeed(
      null,
      filters({
        statuses: ["in_progress", "backlog"],
        priorities: ["urgent", "low"],
        types: ["bugfix", "feature"],
        estimates: ["m"],
        assignees: ["Vakhnin Sergei", "bob"],
      }),
    );
    expect(seed).toMatchObject({
      status: "in_progress",
      priority: "urgent",
      type: "bugfix",
      estimate: "m",
      assignee: "Vakhnin Sergei",
    });
  });

  it("carries every filtered label name", () => {
    expect(newTaskSeed(null, filters({ labelNames: ["ui", "bug"] })).labelNames).toEqual([
      "ui",
      "bug",
    ]);
  });

  it("puts every value it sets inside the filter it came from", () => {
    fc.assert(
      fc.property(filtersArb, tasksArb, (state, rows) => {
        const seed = newTaskSeed(PROJECT, state);
        const within = <T,>(list: readonly T[], value: T | null) =>
          list.length === 0 || (value !== null && list.includes(value));
        expect(within(state.statuses, seed.status)).toBe(true);
        expect(within(state.priorities, seed.priority)).toBe(true);
        expect(within(state.types, seed.type)).toBe(true);
        expect(within(state.estimates, seed.estimate)).toBe(true);
        expect(within(state.assignees, seed.assignee)).toBe(true);
        expect(seed.labelNames).toEqual(state.labelNames);
        expect(seed.projectId).toBe(PROJECT);
      }),
    );
  });

  it("lands the untouched draft in the list whenever the list shows anything", () => {
    const rowArb = fc.record({
      status: fc.constantFrom(...TASK_STATUSES),
      priority: fc.constantFrom(...TASK_PRIORITIES),
      type: fc.option(fc.constantFrom(...TASK_TYPES), { nil: null }),
      estimate: fc.option(fc.constantFrom(...TASK_ESTIMATES), { nil: null }),
      assignee: fc.option(fc.constantFrom(...NAMES), { nil: null }),
      epic: fc.option(fc.constantFrom("alpha", "beta"), { nil: null }),
    });
    fc.assert(
      fc.property(filtersArb, fc.array(rowArb, { maxLength: 8 }), (state, rows) => {
        const unlabelled = { ...state, labelNames: [] };
        // On disk an epic folder sits inside an assignee's: no epic without one.
        const tasks = rows.map(
          (row) =>
            ({ ...row, epic: row.assignee === null ? null : row.epic, labelIds: [] }) as unknown as Task,
        );
        const shown = tasks.filter((task) => matchesFilters(task, unlabelled, []));
        fc.pre(shown.length > 0);
        const seed = newTaskSeed(null, unlabelled);
        const draft = { ...seed, labelIds: [] } as unknown as Task;
        expect(matchesFilters(draft, unlabelled, [])).toBe(true);
      }),
    );
  });

});

function label(id: string, projectId: string, name: string): Label {
  return { id, projectId, name, color: "#888" };
}

describe("labelIdsByName", () => {
  const labels = [
    label("L1", PROJECT, "ui"),
    label("L2", PROJECT, "bug"),
    label("L3", OTHER, "ui"),
    label("L4", OTHER, "docs"),
  ];

  it("maps names to the project's own labels, in the order asked", () => {
    expect(labelIdsByName(labels, PROJECT, ["bug", "ui"])).toEqual(["L2", "L1"]);
    expect(labelIdsByName(labels, OTHER, ["bug", "ui"])).toEqual(["L3"]);
  });

  it("returns only the project's labels, at most one per name", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(PROJECT, OTHER),
        fc.array(fc.constantFrom("ui", "bug", "docs", "gone")),
        (projectId, names) => {
          const ids = labelIdsByName(labels, projectId, names);
          const picked = ids.map((id) => labels.find((entry) => entry.id === id)!);
          expect(picked.every((entry) => entry.projectId === projectId)).toBe(true);
          expect(new Set(ids).size).toBe(ids.length);
          expect(ids.length).toBeLessThanOrEqual(new Set(names).size);
        },
      ),
    );
  });
});
