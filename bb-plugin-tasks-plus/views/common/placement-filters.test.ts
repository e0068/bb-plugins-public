// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { parentFilterOptions } from "./lib.js";
import { idsUnder } from "../../shared/subtree.js";
import { matchesFilters } from "../../shared/task-fields.js";
import { uniqueStrings, sanitizeListPreference } from "./list-preference.js";
import { EMPTY_FILTERS, hasActiveFilters } from "./filter-state.js";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function task(overrides: Partial<Task> = {}): Task {
  return {
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
    startDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

describe("uniqueStrings", () => {
  it("reads anything that is not an array as an empty list", () => {
    expect(uniqueStrings(null)).toEqual([]);
    expect(uniqueStrings("one")).toEqual([]);
    expect(uniqueStrings(undefined)).toEqual([]);
  });

  it("drops entries that are not strings", () => {
    expect(uniqueStrings(["a", 3, null, "b"])).toEqual(["a", "b"]);
  });

  it("collapses repeats and keeps the input order", () => {
    expect(uniqueStrings(["b", "a", "b"])).toEqual(["b", "a"]);
  });

  it("drops entries the caller's check refuses", () => {
    expect(uniqueStrings(["a", "b"], (value) => value === "a")).toEqual(["a"]);
  });
});

describe("matchesFilters with placement", () => {
  it("lets every task through an empty filter state", () => {
    expect(matchesFilters(task(), EMPTY_FILTERS, [])).toBe(true);
  });

  it("keeps a task whose assignee is picked", () => {
    expect(
      matchesFilters(
        task({ assignee: "Anna" }),
        { ...EMPTY_FILTERS, assignees: ["Anna"] },
        [],
      ),
    ).toBe(true);
  });

  it("drops a task of another assignee", () => {
    expect(
      matchesFilters(
        task({ assignee: "Sergey" }),
        { ...EMPTY_FILTERS, assignees: ["Anna"] },
        [],
      ),
    ).toBe(false);
  });

  it("drops a task with no assignee at all", () => {
    expect(
      matchesFilters(task(), { ...EMPTY_FILTERS, assignees: ["Anna"] }, []),
    ).toBe(false);
  });

  it("still honours the older filters", () => {
    expect(
      matchesFilters(
        task({ status: "done" }),
        { ...EMPTY_FILTERS, statuses: ["todo"] },
        [],
      ),
    ).toBe(false);
  });
});

describe("filter state", () => {
  it("counts a picked assignee as an active filter", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, assignees: ["Anna"] })).toBe(
      true,
    );
  });

});

describe("the parent filter", () => {
  const EPIC = "B1:flow-epic";
  const tree = [
    task({ id: EPIC, key: "T-1", title: "Flow", type: "epic" }),
    task({ id: "B1:child", key: "T-2", title: "Child", parentTaskId: EPIC }),
    task({ id: "B1:grandchild", key: "T-3", title: "Grandchild", parentTaskId: "B1:child" }),
    task({ id: "B1:loose", key: "T-4", title: "Loose" }),
    task({ id: "B1:parent", key: "T-5", title: "A parent", parentTaskId: null }),
    task({ id: "B1:under-parent", key: "T-6", title: "Under a parent", parentTaskId: "B1:parent" }),
  ];
  const passing = (parents: string[]) => {
    const under = idsUnder(tree, parents);
    return tree.filter((entry) => matchesFilters(entry, { ...EMPTY_FILTERS, parents }, [], under)).map((entry) => entry.id);
  };

  it("starts with no parent picked, and a picked one counts as an active filter", () => {
    expect(EMPTY_FILTERS.parents).toEqual([]);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, parents: [EPIC] })).toBe(true);
  });

  it("lets through every task under a picked parent, at any depth, and not the parent itself", () => {
    expect(passing([EPIC])).toEqual(["B1:child", "B1:grandchild"]);
    expect(passing(["B1:child"])).toEqual(["B1:grandchild"]);
  });

  it("lets through what lies under any of several picked parents", () => {
    expect(passing([EPIC, "B1:parent"])).toEqual(["B1:child", "B1:grandchild", "B1:under-parent"]);
  });

  it("lets nothing through for a picked task with nothing under it, and everything when none is picked", () => {
    expect(passing(["B1:loose"])).toEqual([]);
    expect(passing([])).toEqual(tree.map((entry) => entry.id));
  });

  it("offers only the tasks with a task under them, epics first", () => {
    expect(parentFilterOptions(tree).map((option) => [option.key, option.slug, option.title])).toEqual([
      ["T-1", "flow-epic", "Flow"],
      ["T-2", "child", "Child"],
      ["T-5", "parent", "A parent"],
    ]);
  });

  it("restores picked parents from the stored preference, dropping what is not a task id and the old epic filter", () => {
    const restored = sanitizeListPreference({
      filters: { assignees: ["Anna", "Anna"], parents: [EPIC, "Tasks+", EPIC, ":", "B1:"], epics: ["B1:other-epic"] },
      sort: "start",
    });
    expect(restored.filters.assignees).toEqual(["Anna"]);
    expect(restored.filters.parents).toEqual([EPIC]);
    expect(restored.filters).not.toHaveProperty("epics");
    expect(restored.sort).toBe("start");
  });
});
