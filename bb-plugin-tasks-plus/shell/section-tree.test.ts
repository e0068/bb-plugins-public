// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { closedAtDepth, foldedLevel, foldLevels, toggleOpen, treeKey, treeRows, type SectionNode } from "./section-tree.js";

const node = (id: string, ...children: SectionNode[]): SectionNode => ({ id, children });

// project
//   a
//     a1
//   b
// lone
const TREE = [node("project", node("a", node("a1")), node("b")), node("lone")];

const ids = (closed: ReadonlySet<string>) => treeRows(TREE, closed).map((row) => row.id);

describe("the project tree", () => {
  it("draws every row while nothing is closed, each section under its holder", () => {
    expect(treeRows(TREE, new Set())).toEqual([
      { id: "project", depth: 0, branch: true, open: true },
      { id: "a", depth: 1, branch: true, open: true },
      { id: "a1", depth: 2, branch: false, open: false },
      { id: "b", depth: 1, branch: false, open: false },
      { id: "lone", depth: 0, branch: false, open: false },
    ]);
  });

  it("hides what a closed branch holds and shows it again once reopened", () => {
    const closed = toggleOpen(new Set(), "a");
    expect(ids(closed)).toEqual(["project", "a", "b", "lone"]);
    expect(ids(toggleOpen(closed, "a"))).toEqual(ids(new Set()));
  });

  it("folds to a level: one shows the projects alone, the deepest shows everything", () => {
    expect(foldLevels(TREE)).toEqual([1, 2, 3]);
    expect(ids(closedAtDepth(TREE, 1))).toEqual(["project", "lone"]);
    expect(ids(closedAtDepth(TREE, 2))).toEqual(["project", "a", "b", "lone"]);
    expect(ids(closedAtDepth(TREE, 3))).toEqual(ids(new Set()));
  });

  it("names the level it is folded to, and none once a branch was folded by hand", () => {
    expect(foldedLevel(TREE, closedAtDepth(TREE, 2))).toBe(2);
    expect(foldedLevel(TREE, new Set(["project"]))).toBe(1);
    expect(foldedLevel(TREE, new Set(["a", "lone-gone"]))).toBe(2);
    expect(foldedLevel([node("p", node("x", node("x1")), node("y", node("y1")))], new Set(["x"]))).toBeNull();
  });

  it("draws each row at most once and never a row under a closed branch, however it is folded", () => {
    const all = ["project", "a", "a1", "b", "lone"];
    fc.assert(
      fc.property(fc.subarray(all), (closedIds) => {
        const rows = ids(new Set(closedIds));
        expect(new Set(rows).size).toBe(rows.length);
        if (closedIds.includes("project")) expect(rows).toEqual(["project", "lone"]);
        if (closedIds.includes("a")) expect(rows).not.toContain("a1");
      }),
    );
  });
});

describe("the arrows on the project tree", () => {
  const rows = treeRows(TREE, new Set());

  it("walk up and down the drawn rows and stop at the ends", () => {
    expect(treeKey(rows, "a", "ArrowDown").current).toBe("a1");
    expect(treeKey(rows, "lone", "ArrowDown").current).toBe("lone");
    expect(treeKey(rows, "project", "ArrowUp").current).toBe("project");
    expect(treeKey(rows, "b", "Home").current).toBe("project");
    expect(treeKey(rows, "b", "End").current).toBe("lone");
  });

  it("close an open branch with the left arrow and go to the holder from a leaf", () => {
    expect(treeKey(rows, "a", "ArrowLeft")).toEqual({ current: "a", toggle: "a" });
    expect(treeKey(rows, "a1", "ArrowLeft")).toEqual({ current: "a", toggle: null });
  });

  it("open a closed branch with the right arrow and go into an open one", () => {
    expect(treeKey(treeRows(TREE, new Set(["a"])), "a", "ArrowRight")).toEqual({ current: "a", toggle: "a" });
    expect(treeKey(rows, "a", "ArrowRight")).toEqual({ current: "a1", toggle: null });
  });

  it("leave other keys alone", () => {
    expect(treeKey(rows, "a", "x")).toEqual({ current: "a", toggle: null });
  });
});
