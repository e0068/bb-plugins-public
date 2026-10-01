import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { StatusTransition } from "../db/transition-log.js";
import type { Task } from "../shared/contract.js";
import { ALL_TIME, MAX_CARD_CHART_DAYS } from "../shared/enums.js";
import { burndownEnds, forecastDays, openSeries, openSeriesOf } from "./burndown.js";
import { movesByTask } from "./flow.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

const task = (id: string, status: Task["status"], createdDay = 0) =>
  ({ id, status, createdAt: new Date(T0 + createdDay * DAY).toISOString() }) as Task;
const move = (taskId: string, fromStatus: string | null, toStatus: string, day: number): StatusTransition => ({
  taskId,
  projectId: "P",
  fromStatus,
  toStatus,
  atMs: T0 + day * DAY,
  actor: null,
});
const ends = (days: number) => Array.from({ length: days }, (_, i) => T0 + (i + 1) * DAY);

describe("openSeries", () => {
  it("counts the tasks still owing work at the end of each day", () => {
    const tasks = [task("a", "done"), task("b", "in_progress"), task("c", "todo", 2.5)];
    const moves = [move("a", "todo", "in_progress", 0.5), move("a", "in_progress", "done", 1.5), move("b", "todo", "in_progress", 1.2)];
    // day 1 end: a in progress, b todo; day 2: a done, b in progress; day 3: + c
    expect(openSeries(tasks, moves, ends(3))).toEqual([2, 1, 2]);
  });

  it("reads a task never moved as standing in its status all along, from the day it was made", () => {
    expect(openSeries([task("a", "todo", 1.5), task("b", "done")], [], ends(3))).toEqual([0, 1, 1]);
  });

  it("never counts more than the tasks made by that day", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom<Task["status"]>("todo", "done", "in_review"), fc.integer({ min: 0, max: 5 })), { maxLength: 8 }),
        (rows) => {
          const tasks = rows.map(([status, day], index) => task(`t${index}`, status, day));
          const series = openSeries(tasks, [], ends(6));
          series.forEach((open, day) => {
            expect(open).toBeLessThanOrEqual(tasks.filter((t) => Date.parse(t.createdAt) < ends(6)[day]!).length);
          });
        },
      ),
    );
  });
});

describe("forecastDays", () => {
  it("is the days left at the trend's pace, and none while the trend does not fall", () => {
    expect(forecastDays([6, 5, 4, 3])).toBe(3);
    expect(forecastDays([2, 2, 2])).toBeNull();
    expect(forecastDays([1, 2])).toBeNull();
    expect(forecastDays([4])).toBeNull();
    expect(forecastDays([3, 0])).toBe(0);
  });
});

describe("openSeriesOf", () => {
  it("reads the moves grouped once per call, the same series as the raw log gives", () => {
    const tasks = [task("a", "done"), task("b", "in_progress")];
    const log = [move("a", "todo", "done", 1.5), move("b", "todo", "in_progress", 0.5)];
    expect(openSeriesOf(tasks, movesByTask(log), ends(3))).toEqual(openSeries(tasks, log, ends(3)));
  });
});

describe("forecastDays over columns longer than a day", () => {
  it("turns the pace per column into days", () => {
    // Two a week gone, four left: two more weeks, fourteen days.
    expect(forecastDays([8, 6, 4], 7)).toBe(14);
    expect(forecastDays([8, 6, 4], 1)).toBe(2);
  });
});

describe("burndownEnds — the column ends of a card's burndown for a period in days", () => {
  const NOW = T0 + 100 * DAY + 3_600_000;
  const WEEK = 7 * DAY;

  it("reads any number of days day by day, one end per day back and the last one now", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_CARD_CHART_DAYS }), (days) => {
        expect(burndownEnds(days, NOW, T0)).toEqual(Array.from({ length: days + 1 }, (_, i) => NOW - (days - i) * DAY));
      }),
      { numRuns: 30 },
    );
  });

  it("reads all time week by week, from the first week holding the first task through now", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 * DAY }), (age) => {
        const ends = burndownEnds(ALL_TIME, NOW, NOW - age);
        expect(ends.length).toBeGreaterThanOrEqual(2);
        expect(ends[ends.length - 1]).toBe(NOW);
        expect(ends[0]).toBeLessThanOrEqual(NOW - age);
        expect(ends[1]).toBeGreaterThanOrEqual(NOW - age);
        ends.slice(1).forEach((end, i) => expect(end - ends[i]!).toBe(WEEK));
      }),
    );
  });

  it("gives all time one week when nothing is older than now", () => {
    expect(burndownEnds(ALL_TIME, NOW, NOW + DAY)).toEqual([NOW - WEEK, NOW]);
  });
});

describe("burndownEnds over all time from an unreadable first date", () => {
  it("reads all time as a single week when the oldest task's date does not read", () => {
    const NOW = T0 + 100 * DAY;
    expect(burndownEnds(ALL_TIME, NOW, Number.NEGATIVE_INFINITY)).toEqual([NOW - 7 * DAY, NOW]);
    expect(burndownEnds(ALL_TIME, NOW, Number.NaN)).toEqual([NOW - 7 * DAY, NOW]);
  });
});
