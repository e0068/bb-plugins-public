// @vitest-environment node
import { describe, expect, it } from "vitest";

import { WINDOW_COUNT_MAX, WINDOW_UNITS } from "./analytics-tile.js";
import { parseDashboard } from "./contract.js";

const tile = (window: unknown) => ({
  id: "t",
  type: "columns",
  title: "T",
  window,
  x: "time",
  y: { metric: "count", field: null },
  breakdown: null,
  switch: null,
  conditions: [],
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
});
const board = (window: unknown) => ({ version: 1, tiles: [tile(window)], rows: [{ id: "r", height: 200, minHeight: 100, cells: [{ id: "t", weight: 1 }] }] });

describe("a tile's period", () => {
  it("is the header's, or the last N minutes, hours or days", () => {
    expect(WINDOW_UNITS).toEqual(["minute", "hour", "day"]);
    expect(parseDashboard(board("page"))?.tiles[0]?.window).toBe("page");
    expect(parseDashboard(board({ unit: "minute", count: 90 }))?.tiles[0]?.window).toEqual({ unit: "minute", count: 90 });
  });

  it("keeps N between 1 and the unit's cap", () => {
    for (const unit of WINDOW_UNITS) {
      expect(parseDashboard(board({ unit, count: WINDOW_COUNT_MAX[unit] }))).not.toBeNull();
      expect(parseDashboard(board({ unit, count: WINDOW_COUNT_MAX[unit] + 1 }))).toBeNull();
      expect(parseDashboard(board({ unit, count: 0 }))).toBeNull();
    }
  });

  it("reads the old fixed periods as hours and days", () => {
    expect(parseDashboard(board("last24h"))?.tiles[0]?.window).toEqual({ unit: "hour", count: 24 });
    expect(parseDashboard(board("last30d"))?.tiles[0]?.window).toEqual({ unit: "day", count: 30 });
    expect(parseDashboard(board("last8w"))?.tiles[0]?.window).toEqual({ unit: "day", count: 56 });
  });
});
