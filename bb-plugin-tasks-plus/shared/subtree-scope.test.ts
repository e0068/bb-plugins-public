import { describe, expect, it } from "vitest";
import type { TaskStatus } from "./enums.js";
import { subtasksInScope, type Descendant } from "./subtree.js";

const row = (id: string, depth: number, status: TaskStatus): Descendant<{ id: string; status: TaskStatus }> => ({
  task: { id, status },
  depth,
});

// A tree as a card lists it: each subtree right after its root.
const tree = [
  row("open-child", 1, "todo"),
  row("done-child", 1, "done"),
  row("open-grandchild", 2, "in_progress"),
  row("canceled-child", 1, "canceled"),
  row("done-grandchild", 2, "done"),
  row("review-child", 1, "in_review"),
];
const ids = (rows: readonly Descendant<{ id: string }>[]) => rows.map(({ task }) => task.id);

describe("subtasksInScope", () => {
  it("keeps every sub-task in the all scope", () => {
    expect(subtasksInScope(tree, "all")).toEqual(tree);
  });

  it("keeps only open children, one level down, in the open-children scope", () => {
    expect(ids(subtasksInScope(tree, "open-children"))).toEqual(["open-child", "review-child"]);
  });

  it("keeps open sub-tasks at any depth, and a closed one only as the parent of an open one", () => {
    expect(ids(subtasksInScope(tree, "open"))).toEqual(["open-child", "done-child", "open-grandchild", "review-child"]);
  });

  it("counts neither done nor canceled as open", () => {
    const closed = [row("done", 1, "done"), row("canceled", 1, "canceled")];
    expect(subtasksInScope(closed, "open")).toEqual([]);
    expect(subtasksInScope(closed, "open-children")).toEqual([]);
  });
});
