import { describe, expect, it } from "vitest";
import { TILE_TABLE_COLUMNS_START, TOTAL_FNS, tileTable, totalFnsOf, withTotal } from "./analytics-tile.js";

const stored = { columns: ["key", "title"] as ("key" | "title")[], sort: null, rows: 10, rowHeight: "compact" as const };

describe("the totals of the table under a tile's chart", () => {
  it("offers Unique, Sum and Median, in that order", () => {
    expect(TOTAL_FNS).toEqual(["unique", "sum", "median"]);
  });

  it("starts with no totals, for a tile without a table and for one saved before totals", () => {
    expect(tileTable({}).totals).toEqual([]);
    expect(tileTable({}).columns).toEqual(TILE_TABLE_COLUMNS_START);
    expect(tileTable({ table: stored })).toEqual({ ...stored, totals: [] });
  });

  it("keeps the totals a tile saved", () => {
    const totals = [{ column: "cost" as const, fn: "sum" as const }];
    expect(tileTable({ table: { ...stored, totals } }).totals).toEqual(totals);
  });

  it("offers Sum and Median only on a numeric column", () => {
    expect(totalFnsOf("cost")).toEqual(["unique", "sum", "median"]);
    expect(totalFnsOf("plannedMinutes")).toEqual(["unique", "sum", "median"]);
    expect(totalFnsOf("status")).toEqual(["unique"]);
    expect(totalFnsOf("threads")).toEqual(["unique"]);
  });

  it("sets one column's total and leaves the others, a column keeping a single total", () => {
    const totals = [{ column: "cost" as const, fn: "sum" as const }];
    expect(withTotal(totals, "status", "unique")).toEqual([...totals, { column: "status", fn: "unique" }]);
    expect(withTotal(totals, "cost", "median")).toEqual([{ column: "cost", fn: "median" }]);
  });

  it("takes a column's total away with none, and no other", () => {
    const totals = [{ column: "cost" as const, fn: "sum" as const }, { column: "status" as const, fn: "unique" as const }];
    expect(withTotal(totals, "cost", null)).toEqual([{ column: "status", fn: "unique" }]);
    expect(withTotal(totals, "key", null)).toEqual(totals);
  });
});
