// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { aMove, aTask, oct } from "../test-support/analytics-tasks";
import { ascending, cycleMs, median, p90, planFact, sinceOf, statusBefore } from "./flow.js";

describe("median and p90", () => {
  it("take the middle — the mean of two middles when even — and the nearest-rank 90th", () => {
    expect(median([1, 2, 9])).toBe(2);
    expect(median([1, 2, 3, 9])).toBe(2.5);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p90([7])).toBe(7);
  });

  it("lie within the values", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1 }), (values) => {
        const sorted = ascending(values);
        for (const middle of [median(sorted), p90(sorted)]) {
          expect(middle).toBeGreaterThanOrEqual(sorted[0]!);
          expect(middle).toBeLessThanOrEqual(sorted.at(-1)!);
        }
      }),
    );
  });
});

describe("statusBefore — where a task stood at a moment", () => {
  const task = aTask(1, { status: "done" });
  const moves = [aMove(task, "todo", "in_progress", oct(2)), aMove(task, "in_progress", "done", oct(4))];

  it("reads the last earlier move, what the first move left before it, and the status now with no moves", () => {
    expect(statusBefore(task, moves, oct(3))).toBe("in_progress");
    expect(statusBefore(task, moves, oct(1))).toBe("todo");
    expect(statusBefore(task, [], oct(1))).toBe("done");
  });
});

describe("cycleMs — first move into progress to the closing", () => {
  const task = aTask(1, { status: "done" });
  const closing = { taskId: task.id, projectId: task.projectId, atMs: oct(5), bin: 0 };

  it("measures from the first move into in progress", () => {
    expect(cycleMs(closing, [aMove(task, "todo", "in_progress", oct(2)), aMove(task, "in_progress", "in_progress", oct(3))])).toBe(oct(5) - oct(2));
  });

  it("is absent for a task never seen in progress before its closing", () => {
    expect(cycleMs(closing, [aMove(task, "todo", "done", oct(5))])).toBeUndefined();
  });
});

describe("planFact — plan against fact", () => {
  it("takes the medians and the median ratio of the pairs carrying both", () => {
    expect(planFact([[60, 90], [30, 30], [null, 10], [20, null]])).toEqual({ count: 2, planned: 45, actual: 60, ratio: 1.25 });
  });

  it("is none without a pair carrying both, and a ratio of 0 when every plan is zero", () => {
    expect(planFact([[null, 1]])).toBeUndefined();
    expect(planFact([[0, 5]])?.ratio).toBe(0);
  });
});

describe("sinceOf — since when a task stands in its status", () => {
  it("is its last move into the status, else its creation", () => {
    const task = aTask(1, { status: "in_review", createdAt: new Date(oct(1)).toISOString() });
    expect(sinceOf(task, [aMove(task, "todo", "in_review", oct(2)), aMove(task, "in_review", "todo", oct(3)), aMove(task, "todo", "in_review", oct(4))])).toBe(oct(4));
    expect(sinceOf(task, [])).toBe(oct(1));
  });
});
