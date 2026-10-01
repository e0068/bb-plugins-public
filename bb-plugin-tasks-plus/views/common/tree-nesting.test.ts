// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { TASK_STATUSES } from "../../shared/enums.js";
import { nestSubtasks } from "./lib.js";

const task = (id: string, parentTaskId: string | null, status: Task["status"] = "todo") =>
  ({ id, parentTaskId, status }) as Task;

describe("nestSubtasks at any depth", () => {
  it("puts every descendant under its parent, one level deeper each time, under the top task's status", () => {
    const rows = nestSubtasks([
      task("E", null, "in_progress"),
      task("B", "E", "done"),
      task("U", "B"),
      task("E2", "U", "todo"),
      task("L", null),
    ]);
    expect(rows.map((row) => [row.task.id, row.depth, row.groupStatus])).toEqual([
      ["E", 0, "in_progress"],
      ["B", 1, "in_progress"],
      ["U", 2, "in_progress"],
      ["E2", 3, "in_progress"],
      ["L", 0, "todo"],
    ]);
  });

  it("lists every task exactly once, whatever the tree", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(), fc.constantFrom(...TASK_STATUSES), fc.boolean()), { maxLength: 15 }), (rows) => {
        const tasks = rows.map(([pick, status, top], index) =>
          task(`T${index}`, index === 0 || top ? null : `T${pick % index}`, status),
        );
        const ids = nestSubtasks(tasks).map((row) => row.task.id);
        expect([...ids].sort()).toEqual(tasks.map((t) => t.id).sort());
      }),
    );
  });
});
