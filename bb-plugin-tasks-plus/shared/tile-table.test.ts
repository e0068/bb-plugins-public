import { describe, expect, it } from "vitest";

import { TILE_TABLE_COLUMNS_START, TILE_TABLE_FIELDS, TILE_TABLE_ROWS, tileTable } from "./analytics-tile.js";
import { tileSchema } from "./contract.js";

const tile = (patch: Record<string, unknown> = {}) => ({
  id: "t",
  type: "columns",
  title: "T",
  window: "page",
  x: "time",
  y: { metric: "count", field: null },
  breakdown: null,
  switch: null,
  conditions: [],
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false, contents: 0.6 },
  ...patch,
});

const table = (patch: Record<string, unknown> = {}) => ({ columns: ["key", "title", "cost"], sort: { column: "cost", direction: "desc" }, rows: 20, rowHeight: "compact", ...patch });

describe("the table under a tile's chart", () => {
  it("reads a tile saved before it had a table with the starting settings", () => {
    const parsed = tileSchema.parse(tile());
    expect(tileTable(parsed)).toEqual({ columns: [...TILE_TABLE_COLUMNS_START], sort: null, rows: TILE_TABLE_ROWS.start, rowHeight: "regular" });
  });

  it("reads back the settings a tile keeps", () => {
    const parsed = tileSchema.parse(tile({ table: table() }));
    expect(tileTable(parsed)).toEqual(table());
  });

  it("starts with columns the table can draw, the title among them", () => {
    expect(TILE_TABLE_COLUMNS_START).toContain("title");
    TILE_TABLE_COLUMNS_START.forEach((column) => expect(TILE_TABLE_FIELDS).toContain(column));
  });

  it("refuses a table without the title, with a column twice, or one it cannot draw", () => {
    expect(tileSchema.safeParse(tile({ table: table({ columns: ["key", "cost"] }) })).success).toBe(false);
    expect(tileSchema.safeParse(tile({ table: table({ columns: ["title", "key", "key"] }) })).success).toBe(false);
    expect(tileSchema.safeParse(tile({ table: table({ columns: ["title", "subtasks"] }) })).success).toBe(false);
  });

  it("keeps the rows a segment shows inside their bounds", () => {
    expect(tileSchema.safeParse(tile({ table: table({ rows: TILE_TABLE_ROWS.max }) })).success).toBe(true);
    expect(tileSchema.safeParse(tile({ table: table({ rows: TILE_TABLE_ROWS.max + 1 }) })).success).toBe(false);
    expect(tileSchema.safeParse(tile({ table: table({ rows: TILE_TABLE_ROWS.min }) })).success).toBe(true);
    expect(tileSchema.safeParse(tile({ table: table({ rows: TILE_TABLE_ROWS.min - 1 }) })).success).toBe(false);
  });
});
