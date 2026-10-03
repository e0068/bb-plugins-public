import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Task } from "./contract.js";
import { OPEN_STATUSES, QUERY_FIELDS, SORT_MENU_FIELDS, TASK_STATUSES, type TaskStatus } from "./enums.js";
import { descendantsOf, progressOf } from "./subtree.js";
import { compareByField, factsOf } from "./task-fields.js";

const node = (id: string, parentTaskId: string | null = null, status: TaskStatus = "todo") => ({ id, parentTaskId, status });

describe("an open task", () => {
  it("is one that still owes work: neither done nor canceled", () => {
    expect([...OPEN_STATUSES].sort()).toEqual(TASK_STATUSES.filter((status) => status !== "done" && status !== "canceled").sort());
  });
});

describe("the open sub-tasks of a task", () => {
  it("count the open tasks at every depth under it", () => {
    const tree = descendantsOf([
      node("E"),
      node("A", "E", "done"),
      node("B", "E", "canceled"),
      node("C", "A", "in_review"),
      node("D", "C", "backlog"),
      node("F", "E", "in_progress"),
    ]);
    expect(progressOf(tree.get("E")!).open).toBe(3);
    expect(progressOf(tree.get("D")!).open).toBe(0);
  });

  it("are what is left of the counted work once the done is taken out", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TASK_STATUSES)), (statuses) => {
        const progress = progressOf(statuses.map((status, index) => ({ task: node(`T${index}`, null, status), depth: 1 })));
        expect(progress.open).toBe(progress.total - progress.done);
      }),
    );
  });
});

const task = (number: number): Task => ({ id: `T${number}`, number }) as Task;

describe("sorting by open sub-tasks", () => {
  it("orders by the count, a task without sub-tasks counting zero", () => {
    const facts = factsOf({ openCounts: new Map([["T1", 2], ["T2", 5]]) });
    const by = (direction: "asc" | "desc") =>
      [task(1), task(2), task(3)].sort(compareByField({ column: "openSubtasks", direction }, facts)).map((t) => t.number);
    expect(by("desc")).toEqual([2, 1, 3]);
    expect(by("asc")).toEqual([3, 1, 2]);
  });

  it("is offered by the Sort menu right after Sub-tasks, and by neither Filter nor Display", () => {
    expect(SORT_MENU_FIELDS.slice(SORT_MENU_FIELDS.indexOf("subtasks"), SORT_MENU_FIELDS.indexOf("subtasks") + 2)).toEqual(["subtasks", "openSubtasks"]);
    expect(SORT_MENU_FIELDS.filter((field) => field !== "openSubtasks")).toEqual(QUERY_FIELDS);
  });
});
