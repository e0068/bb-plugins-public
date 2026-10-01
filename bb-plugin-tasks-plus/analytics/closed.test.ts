import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { StatusTransition } from "../db/transition-log.js";
import { closedInBins } from "./closed";

function move(taskId: string, toStatus: string, atMs: number, projectId = "P"): StatusTransition {
  return { taskId, projectId, fromStatus: null, toStatus, atMs, actor: null };
}

const EDGES = [0, 10, 20, 30];

describe("closedInBins — which column a closed task lands in", () => {
  it("places a task moved to done into the column whose range holds the move", () => {
    expect(closedInBins([move("A", "done", 15)], EDGES)).toEqual([{ taskId: "A", projectId: "P", atMs: 15, bin: 1 }]);
  });

  it("treats a column as [start, end): a move exactly on an edge belongs to the later column", () => {
    expect(closedInBins([move("A", "done", 10)], EDGES).map((entry) => entry.bin)).toEqual([1]);
  });

  it("ignores moves before the first edge and at or after the last edge", () => {
    expect(closedInBins([move("A", "done", -1), move("B", "done", 30)], EDGES)).toEqual([]);
  });

  it("counts a task closed, reopened and closed again once — at its last closing", () => {
    const log = [move("A", "done", 5), move("A", "in_progress", 12), move("A", "done", 25)];
    expect(closedInBins(log, EDGES)).toEqual([{ taskId: "A", projectId: "P", atMs: 25, bin: 2 }]);
  });

  it("drops a task whose last move in the window took it out of done", () => {
    expect(closedInBins([move("A", "done", 5), move("A", "in_review", 12)], EDGES)).toEqual([]);
  });

  it("does not count canceled as closed", () => {
    expect(closedInBins([move("A", "canceled", 5)], EDGES)).toEqual([]);
  });

  it("keeps the project of the closing move", () => {
    expect(closedInBins([move("A", "done", 5, "Q")], EDGES)[0]?.projectId).toBe("Q");
  });

  it("returns closings ordered by time", () => {
    const log = [move("B", "done", 25), move("A", "done", 3)];
    expect(closedInBins(log, EDGES).map((entry) => entry.taskId)).toEqual(["A", "B"]);
  });

  it("yields nothing for fewer than two edges or edges that do not strictly increase", () => {
    const log = [move("A", "done", 5)];
    expect(closedInBins(log, [])).toEqual([]);
    expect(closedInBins(log, [0])).toEqual([]);
    expect(closedInBins(log, [0, 10, 10])).toEqual([]);
    expect(closedInBins(log, [10, 0])).toEqual([]);
  });

  it("puts every task at most once, inside the range of its column", () => {
    const statuses = ["todo", "in_progress", "in_review", "done", "canceled"];
    const arbitraryLog = fc.array(
      fc.record({
        taskId: fc.constantFrom("A", "B", "C", "D"),
        toStatus: fc.constantFrom(...statuses),
        atMs: fc.integer({ min: -20, max: 60 }),
      }),
    );
    const arbitraryEdges = fc
      .uniqueArray(fc.integer({ min: -10, max: 50 }), { minLength: 2, maxLength: 8 })
      .map((values) => [...values].sort((a, b) => a - b));

    fc.assert(
      fc.property(arbitraryLog, arbitraryEdges, (rows, edges) => {
        const log = [...rows].sort((a, b) => a.atMs - b.atMs).map((row) => move(row.taskId, row.toStatus, row.atMs));
        const closings = closedInBins(log, edges);
        const ids = closings.map((entry) => entry.taskId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const entry of closings) {
          expect(entry.bin).toBeGreaterThanOrEqual(0);
          expect(entry.bin).toBeLessThan(edges.length - 1);
          expect(edges[entry.bin]!).toBeLessThanOrEqual(entry.atMs);
          expect(entry.atMs).toBeLessThan(edges[entry.bin + 1]!);
        }
      }),
    );
  });
});
