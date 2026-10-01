import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TASK_STATUSES, type TaskStatus } from "./enums.js";
import { descendantsOf, familiesOf, progressOf } from "./subtree.js";

const node = (id: string, parentTaskId: string | null = null, status: TaskStatus = "todo") => ({ id, parentTaskId, status });

describe("descendantsOf", () => {
  it("lists the whole subtree, each child followed by its own children", () => {
    const tree = descendantsOf([node("E"), node("A", "E"), node("B", "E"), node("A1", "A"), node("A11", "A1")]);
    expect(tree.get("E")!.map(({ task, depth }) => [task.id, depth])).toEqual([
      ["A", 1],
      ["A1", 2],
      ["A11", 3],
      ["B", 1],
    ]);
    expect(tree.get("A11")).toEqual([]);
  });

  it("ends on a parent cycle and never lists a task under itself", () => {
    const tree = descendantsOf([node("A", "B"), node("B", "A")]);
    expect(tree.get("A")!.map(({ task }) => task.id)).toEqual(["B"]);
    expect(tree.get("B")!.map(({ task }) => task.id)).toEqual(["A"]);
  });

  it("puts a task under exactly the tasks above it on its parent chain", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 15 }), (picks) => {
        const tasks = picks.map((pick, index) => node(`T${index}`, index === 0 ? null : `T${pick % index}`));
        const tree = descendantsOf(tasks);
        const parentOf = new Map(tasks.map((task) => [task.id, task.parentTaskId]));
        for (const task of tasks) {
          const ancestors: string[] = [];
          for (let at = parentOf.get(task.id) ?? null; at !== null; at = parentOf.get(at) ?? null) ancestors.push(at);
          const holders = tasks.filter((other) => tree.get(other.id)!.some(({ task: under }) => under.id === task.id));
          expect(holders.map((holder) => holder.id).sort()).toEqual(ancestors.sort());
        }
      }),
    );
  });
});

describe("progressOf", () => {
  it("counts done out of everything but canceled, and keeps the count per status", () => {
    const tree = descendantsOf([node("E"), node("A", "E", "done"), node("B", "E", "canceled"), node("C", "A", "in_progress")]);
    expect(progressOf(tree.get("E")!)).toMatchObject({ done: 1, total: 2, byStatus: { done: 1, canceled: 1, in_progress: 1 } });
  });

  it("per-status counts add up to every descendant", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TASK_STATUSES)), (statuses) => {
        const progress = progressOf(statuses.map((status, index) => ({ task: node(`T${index}`, null, status), depth: 1 })));
        const sum = Object.values(progress.byStatus).reduce((a, b) => a + b, 0);
        expect(sum).toBe(statuses.length);
        expect(progress.total).toBe(statuses.length - progress.byStatus.canceled);
      }),
    );
  });
});

describe("familiesOf", () => {
  it("looks each task's epic up by id and carries its descendants", () => {
    const epic = { ...node("E"), epicId: null };
    const child = { ...node("C", "E"), epicId: "E" };
    const families = familiesOf([epic, child]);
    expect(families.get("C")).toEqual({ epic, descendants: [] });
    expect(families.get("E")).toEqual({ epic: null, descendants: [{ task: child, depth: 1 }] });
  });
});
