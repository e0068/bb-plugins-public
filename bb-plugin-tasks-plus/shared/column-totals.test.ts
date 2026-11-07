import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aTask } from "../test-support/analytics-tasks";
import type { Task } from "./contract.js";
import { columnTotals } from "./column-totals.js";
import { EMPTY_FACTS, factsOf, type TaskFacts } from "./task-fields.js";

const costs = (...values: (number | null)[]): Task[] => values.map((cost, index) => aTask(index + 1, { cost }));
const one = (
  tasks: readonly Task[],
  fn: "unique" | "sum" | "median",
  column: "cost" | "status" | "labels" | "threads" | "project" = "cost",
  facts: TaskFacts = EMPTY_FACTS,
) => columnTotals(tasks, [{ column, fn }], facts)[0]!.value;

const costArb = fc.array(fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }), { maxLength: 40 });

describe("columnTotals", () => {
  it("answers one total per asked column, in the order asked, and none for none", () => {
    expect(columnTotals(costs(1), [], EMPTY_FACTS)).toEqual([]);
    expect(columnTotals(costs(1, 3), [{ column: "status", fn: "unique" }, { column: "cost", fn: "sum" }], EMPTY_FACTS)).toEqual([
      { column: "status", value: 1 },
      { column: "cost", value: 4 },
    ]);
  });

  it("sums the numbers there are, and has no sum of none", () => {
    expect(one(costs(1.5, null, 2.5), "sum")).toBe(4);
    expect(one(costs(null, null), "sum")).toBeNull();
    expect(one([], "sum")).toBeNull();
  });

  it("keeps a sum of dollars on whole cents", () => {
    expect(one(costs(0.1, 0.2), "sum")).toBe(0.3);
  });

  it("takes the middle value, the mean of the two middle ones for an even count", () => {
    expect(one(costs(9), "median")).toBe(9);
    expect(one(costs(5, 1, 9), "median")).toBe(5);
    expect(one(costs(4, 1, 9, 2), "median")).toBe(3);
    expect(one(costs(null, 7), "median")).toBe(7);
    expect(one([], "median")).toBeNull();
  });

  it("counts the distinct filled values, none of them for an empty list", () => {
    expect(one([], "unique")).toBe(0);
    expect(one(costs(3, 3, null, 4), "unique")).toBe(2);
    expect(one([aTask(1, { status: "todo" }), aTask(2, { status: "done" }), aTask(3, { status: "todo" })], "unique", "status")).toBe(2);
  });

  it("counts a task's every label and every thread, once across the tasks", () => {
    const a = aTask(1, { labelIds: ["L1", "L2"] });
    const b = aTask(2, { labelIds: ["L2"] });
    const facts = factsOf({
      labelNames: new Map([["L1", "ui"], ["L2", "api"]]),
      threadTitles: new Map([[a.id, ["Fix", "Review"]], [b.id, ["Review"]]]),
    });
    expect(one([a, b], "unique", "labels", facts)).toBe(2);
    expect(one([a, b], "unique", "threads", facts)).toBe(2);
    expect(one([aTask(3, {})], "unique", "threads", facts)).toBe(0);
  });

  it("has no sum or median of a column that is not a number", () => {
    expect(one([aTask(1, {})], "sum", "status")).toBeNull();
    expect(one([aTask(1, {})], "median", "project")).toBeNull();
  });

  it("keeps the median between the smallest and the largest, and the sum at the numbers' total", () => {
    fc.assert(
      fc.property(costArb, (values) => {
        const present = values.filter((value): value is number => value !== null);
        const median = one(costs(...values), "median");
        if (present.length === 0) {
          expect(median).toBeNull();
          return;
        }
        expect(median).toBeGreaterThanOrEqual(Math.min(...present));
        expect(median).toBeLessThanOrEqual(Math.max(...present));
        expect(one(costs(...values), "sum")).toBe(present.reduce((total, value) => total + value, 0));
      }),
    );
  });

  it("never finds more distinct values than there are tasks", () => {
    fc.assert(
      fc.property(costArb, (values) => {
        expect(one(costs(...values), "unique")).toBeLessThanOrEqual(values.length);
      }),
    );
  });
});
