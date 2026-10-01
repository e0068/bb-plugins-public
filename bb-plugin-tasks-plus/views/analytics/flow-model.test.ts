import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TASK_STATUSES, type TaskStatus } from "../../db/types.js";
import { formatDuration, openByColumn, trendOf, wipByColumn } from "./flow-model";

const counts = (over: Partial<Record<TaskStatus, number>>) =>
  ({ ...Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])), ...over }) as Record<TaskStatus, number>;

describe("openByColumn — what is left to do in a project, column by column", () => {
  it("counts backlog, to do, in progress and in review; not done or canceled", () => {
    const byBin = { P: [counts({ backlog: 2, todo: 1, in_progress: 1, in_review: 1, done: 5, canceled: 3 })] };
    expect(openByColumn(byBin, "P")).toEqual([5]);
  });

  it("is empty for a project with no tasks", () => {
    expect(openByColumn({}, "P")).toEqual([]);
  });
});

describe("wipByColumn — work in progress over every project", () => {
  it("sums in progress and in review across projects, column by column", () => {
    const byBin = {
      P: [counts({ in_progress: 1, in_review: 2 }), counts({ in_progress: 3 })],
      Q: [counts({ in_progress: 4 }), counts({ in_review: 1, done: 9 })],
    };
    expect(wipByColumn(byBin, 2)).toEqual([
      [5, 2],
      [3, 1],
    ]);
  });
});

describe("trendOf — least-squares line through a series", () => {
  it("recovers a straight line exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: 2, max: 40 }), (slope, start, length) => {
        const line = Array.from({ length }, (_, x) => start + slope * x);
        const trend = trendOf(line)!;
        expect(trend.slope).toBeCloseTo(slope, 9);
        expect(trend.start).toBeCloseTo(start, 9);
      }),
    );
  });

  it("has no trend for fewer than two points", () => {
    expect(trendOf([])).toBeNull();
    expect(trendOf([4])).toBeNull();
  });
});

describe("formatDuration", () => {
  it("speaks in minutes under an hour, hours under a day, days above", () => {
    expect(formatDuration(25 * 60_000)).toBe("25 min");
    expect(formatDuration(5.5 * 3_600_000)).toBe("5.5 h");
    expect(formatDuration(1.84 * 86_400_000)).toBe("1.8 d");
  });
});
