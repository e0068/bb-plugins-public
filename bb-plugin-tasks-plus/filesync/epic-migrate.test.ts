import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Task } from "../shared/contract.js";
import { planMigration } from "./epic-migrate.js";

const task = (id: string, patch: Partial<Task> = {}) =>
  ({ id, title: id, type: null, status: "todo", parentTaskId: null, assignee: null, epic: null, ...patch }) as Task;

describe("planMigration", () => {
  it("makes one epic per assignee's epic folder, with the folder's tasks under it", () => {
    const plan = planMigration([
      task("a", { assignee: "Sergey", epic: "Flow", status: "done" }),
      task("b", { assignee: "Sergey", epic: "Flow", status: "in_review" }),
      task("c", { assignee: "Sergey", epic: "Thread Overview" }),
      task("d", { assignee: "Anna", epic: "Flow", status: "done" }),
      task("e", { assignee: "Sergey" }),
    ]);
    expect(plan).toEqual([
      { assignee: "Anna", name: "Flow", status: "done", existingId: null, taskIds: ["d"], childIds: ["d"] },
      { assignee: "Sergey", name: "Flow", status: "in_progress", existingId: null, taskIds: ["a", "b"], childIds: ["a", "b"] },
      { assignee: "Sergey", name: "Thread Overview", status: "todo", existingId: null, taskIds: ["c"], childIds: ["c"] },
    ]);
  });

  it("moves every task of the folder, but only a task with no parent becomes the epic's child — a parent is never lost", () => {
    const plan = planMigration([
      task("p", { assignee: "Sergey", epic: "Flow" }),
      task("s", { assignee: "Sergey", epic: "Flow", parentTaskId: "p" }),
      task("x", { assignee: "Sergey", epic: "Flow", parentTaskId: "outside" }),
    ]);
    expect(plan[0]).toMatchObject({ taskIds: ["p", "s", "x"], childIds: ["p"] });
  });

  it("reuses an epic task of that name and assignee made before, so a second run changes nothing", () => {
    const plan = planMigration([
      task("E", { type: "epic", title: "Flow", assignee: "Sergey" }),
      task("a", { assignee: "Sergey", epic: "Flow" }),
    ]);
    expect(plan[0]).toMatchObject({ existingId: "E", taskIds: ["a"], childIds: ["a"] });
    expect(planMigration([task("E", { type: "epic", title: "Flow", assignee: "Sergey" }), task("a", { assignee: "Sergey", parentTaskId: "E" })])).toEqual([]);
  });

  it("puts every task of an epic folder in exactly one group, and no other task in any", () => {
    const row = fc.record({
      assignee: fc.constantFrom("Anna", "Sergey"),
      epic: fc.option(fc.constantFrom("Flow", "Docs"), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 12 }), (rows) => {
        const tasks = rows.map((r, index) => task(`t${index}`, r));
        const grouped = planMigration(tasks).flatMap((group) => group.taskIds);
        expect([...grouped].sort()).toEqual(tasks.filter((t) => t.epic !== null).map((t) => t.id).sort());
      }),
    );
  });
});
