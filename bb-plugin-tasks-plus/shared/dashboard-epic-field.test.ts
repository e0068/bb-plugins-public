// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseDashboard } from "./contract.js";

const tile = (over: Record<string, unknown>) => ({
  id: "epics",
  type: "columns",
  title: "By epic",
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
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: true },
  ...over,
});
const dashboardOf = (stored: Record<string, unknown>) =>
  parseDashboard({ version: 1, tiles: [stored], rows: [{ id: "r", height: 200, minHeight: 100, cells: [{ id: "epics", weight: 1 }] }] });

describe("a dashboard saved while Epic was a field", () => {
  it("reads a tile laid out by epic by parent instead", () => {
    const dashboard = dashboardOf(tile({ x: "epic", breakdown: "epic", switch: "epic", sort: { by: "epic", direction: "asc" } }));
    expect(dashboard?.tiles[0]).toMatchObject({ x: "parent", breakdown: "parent", switch: "parent", sort: { by: "parent", direction: "asc" } });
  });

  it("drops a tile's conditions on epic and keeps the rest", () => {
    const dashboard = dashboardOf(
      tile({ conditions: [{ field: "epic", op: "eq", value: "BBPL-1" }, { field: "status", op: "eq", value: "todo" }] }),
    );
    expect(dashboard?.tiles[0]?.conditions).toEqual([{ field: "status", op: "eq", value: "todo" }]);
  });
});
