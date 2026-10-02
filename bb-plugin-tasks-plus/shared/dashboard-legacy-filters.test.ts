// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseDashboard } from "./contract.js";

const legacyTile = {
  id: "burndown",
  type: "columns",
  title: "Burndown",
  window: "page",
  x: "time",
  y: { metric: "count", field: null },
  breakdown: "status",
  switch: "project",
  filters: { statuses: ["todo", "in_progress"], priorities: [], types: [], estimates: [], labelNames: ["ui"], assignees: [], parents: [], texts: { title: "mail" } },
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: true },
};

describe("a dashboard saved while tiles filtered like the board", () => {
  it("reads back with each tile's picked values as = rows", () => {
    const dashboard = parseDashboard({ version: 1, tiles: [legacyTile], rows: [{ id: "r", height: 200, minHeight: 100, cells: [{ id: "burndown", weight: 1 }] }] });
    expect(dashboard?.tiles[0]).toMatchObject({
      id: "burndown",
      conditions: [
        { field: "status", op: "eq", value: "todo" },
        { field: "status", op: "eq", value: "in_progress" },
        { field: "labels", op: "eq", value: "ui" },
      ],
    });
    expect(dashboard?.tiles[0]).not.toHaveProperty("filters");
  });
});
