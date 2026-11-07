import { describe, expect, it } from "vitest";
import { tasksRpcContract, tileSchema } from "./contract.js";

const tile = (table: Record<string, unknown>) => ({
  id: "t",
  type: "columns",
  title: "T",
  window: "page",
  x: "status",
  y: { metric: "count", field: null },
  breakdown: null,
  switch: null,
  conditions: [],
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
  table,
});

const BASE = { columns: ["key", "title", "cost", "status"], sort: null, rows: 50, rowHeight: "regular" };
const accepted = (totals: unknown) => tileSchema.safeParse(tile({ ...BASE, ...(totals === undefined ? {} : { totals }) })).success;

describe("the totals a tile's table is saved with", () => {
  it("reads a tile saved before totals, and one with none", () => {
    expect(accepted(undefined)).toBe(true);
    expect(accepted([])).toBe(true);
  });

  it("accepts Unique on any column and Sum or Median on a number", () => {
    expect(accepted([{ column: "status", fn: "unique" }, { column: "cost", fn: "sum" }])).toBe(true);
    expect(accepted([{ column: "cost", fn: "median" }])).toBe(true);
  });

  it("refuses Sum or Median on a column that is no number", () => {
    expect(accepted([{ column: "status", fn: "sum" }])).toBe(false);
    expect(accepted([{ column: "title", fn: "median" }])).toBe(false);
  });

  it("refuses a total the way it refuses anything else unknown", () => {
    expect(accepted([{ column: "cost", fn: "average" }])).toBe(false);
    expect(accepted([{ column: "cost", fn: "sum", extra: 1 }])).toBe(false);
  });

  it("refuses two totals on one column", () => {
    expect(accepted([{ column: "cost", fn: "sum" }, { column: "cost", fn: "median" }])).toBe(false);
  });

  it("answers the tasks of a segment with the totals, null where there is nothing to total", () => {
    const output = tasksRpcContract.analyticsTileTasks.output;
    expect(output.safeParse({ tasks: [], total: 0, totals: [{ column: "cost", value: null }, { column: "status", value: 3 }] }).success).toBe(true);
    expect(output.safeParse({ tasks: [], total: 0 }).success).toBe(false);
  });
});
