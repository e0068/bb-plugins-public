import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "../../shared/contract.js";
import { TASK_STATUSES } from "../../shared/enums.js";
import type { SortContext } from "./columns.js";
import { tableRows, type RowsInput, type TableGroup } from "./rows.js";

function task(n: number, overrides: Partial<Task> = {}): Task {
  return {
    id: `T${n}`,
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

const CONTEXT: SortContext = { projectNames: new Map(), taskKeys: new Map() };
const INPUT: RowsInput = { groupBy: "status", sort: null, context: CONTEXT, collapsedGroups: [], collapsedTasks: [], labels: [] };

const rowKeys = (groups: readonly TableGroup[]) => groups.flatMap((group) => group.rows.map((row) => row.task.key));

/** A forest: task i's parent is some task before it, or none. */
const forestArb = fc
  .array(fc.record({ parent: fc.option(fc.nat(), { nil: null }), status: fc.constantFrom(...TASK_STATUSES), due: fc.option(fc.integer({ min: 1, max: 28 }), { nil: null }) }), { minLength: 1, maxLength: 12 })
  .map((specs) =>
    specs.map((spec, i) =>
      task(i + 1, {
        status: spec.status as TaskStatus,
        parentTaskId: spec.parent === null || i === 0 ? null : `T${(spec.parent % i) + 1}`,
        dueDate: spec.due === null ? null : `2026-08-${String(spec.due).padStart(2, "0")}`,
      }),
    ),
  );

describe("rows of the table", () => {
  it("every task lands once, children right under their parent", () => {
    fc.assert(
      fc.property(forestArb, (tasks) => {
        const groups = tableRows(tasks, INPUT);
        const keys = rowKeys(groups);
        expect([...keys].sort()).toEqual(tasks.map((t) => t.key).sort());
        for (const group of groups) {
          group.rows.forEach((row, index) => {
            if (row.task.parentTaskId === null) {
              expect(row.depth).toBe(0);
              return;
            }
            const parentIndex = group.rows.findIndex((other) => other.task.id === row.task.parentTaskId);
            expect(parentIndex).toBeGreaterThanOrEqual(0);
            expect(parentIndex).toBeLessThan(index);
            expect(row.depth).toBe(group.rows[parentIndex]!.depth + 1);
          });
        }
      }),
    );
  });

  it("a sub-task follows its root's group", () => {
    const tasks = [task(1, { status: "todo" }), task(2, { status: "done", parentTaskId: "T1" }), task(3, { status: "in_review", parentTaskId: "T2" })];
    const groups = tableRows(tasks, INPUT);
    expect(groups.map((group) => group.key)).toEqual(["todo"]);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.rows.map((row) => [row.task.key, row.depth, row.childCount])).toEqual([
      ["TSK-1", 0, 1],
      ["TSK-2", 1, 1],
      ["TSK-3", 2, 0],
    ]);
  });

  it("a sub-task whose parent is off screen is a root in its own group", () => {
    const groups = tableRows([task(2, { status: "done", parentTaskId: "T9" })], INPUT);
    expect(groups.map((group) => [group.key, group.rows[0]!.depth])).toEqual([["done", 0]]);
  });

  it("groups follow the status order and name themselves", () => {
    const groups = tableRows([task(1, { status: "done" }), task(2, { status: "backlog" })], INPUT);
    expect(groups.map((group) => group.key)).toEqual(["backlog", "done"]);
    expect(groups.every((group) => typeof group.label === "string" && group.label.length > 0)).toBe(true);
  });

  it("no grouping yields one group without a label", () => {
    const groups = tableRows([task(1, { status: "done" }), task(2)], { ...INPUT, groupBy: "none" });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
    expect(rowKeys(groups)).toEqual(["TSK-1", "TSK-2"]);
  });

  it("an empty screen has no groups", () => {
    expect(tableRows([], INPUT)).toEqual([]);
  });
});

describe("sorting and collapsing rows", () => {
  it("sorting orders siblings, never splits a family", () => {
    fc.assert(
      fc.property(forestArb, (tasks) => {
        const groups = tableRows(tasks, { ...INPUT, groupBy: "none", sort: { column: "dueDate", direction: "asc" } });
        const rows = groups[0]!.rows;
        // Siblings (same parent, same depth, consecutive in the parent's block) come in due-date order, empty last.
        const byParent = new Map<string | null, string[]>();
        for (const row of rows) {
          const parent = rows.some((other) => other.task.id === row.task.parentTaskId) ? row.task.parentTaskId : null;
          byParent.set(parent, [...(byParent.get(parent) ?? []), row.task.dueDate ?? "~"]);
        }
        for (const dues of byParent.values()) expect(dues).toEqual([...dues].sort());
        // A family is contiguous: every descendant sits before the next row of its ancestor's depth.
        rows.forEach((row, index) => {
          const next = rows.slice(index + 1).findIndex((other) => other.depth <= row.depth);
          const block = next === -1 ? rows.slice(index + 1) : rows.slice(index + 1, index + 1 + next);
          expect(block.every((other) => other.depth > row.depth)).toBe(true);
        });
      }),
    );
  });

  it("collapsing hides exactly the subtree", () => {
    const tasks = [task(1), task(2, { parentTaskId: "T1" }), task(3, { parentTaskId: "T2" }), task(4)];
    expect(rowKeys(tableRows(tasks, { ...INPUT, collapsedTasks: ["T1"] }))).toEqual(["TSK-1", "TSK-4"]);
    expect(rowKeys(tableRows(tasks, { ...INPUT, collapsedTasks: ["T2"] }))).toEqual(["TSK-1", "TSK-2", "TSK-4"]);
    const collapsedGroup = tableRows(tasks, { ...INPUT, collapsedGroups: ["todo"] });
    expect(collapsedGroup.map((group) => [group.key, group.count, group.rows.length])).toEqual([["todo", 4, 0]]);
  });
});
