// @vitest-environment node
import { describe, expect, it } from "vitest";

import { smallBoard } from "../test-support/analytics-tasks";
import type { Tile } from "../shared/contract.js";
import { factsOf } from "../shared/task-fields.js";
import { tileAnswer } from "./tile.js";

const tile = (conditions: Tile["conditions"]): Tile => ({
  id: "t",
  type: "columns",
  title: "T",
  window: "page",
  x: "status",
  y: { metric: "count", field: null },
  breakdown: null,
  switch: null,
  conditions,
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
});

const count = (conditions: Tile["conditions"]) => {
  const board = smallBoard();
  return tileAnswer({ tile: tile(conditions), tasks: board.tasks, transitions: board.transitions, edges: board.edges, projectIds: [], picked: null, nowMs: board.nowMs, facts: factsOf({}) }).total;
};

describe("tileAnswer over the tile's conditions", () => {
  it("leaves the closed tasks out under status ≠ done", () => {
    expect(count([])).toBe(5);
    expect(count([{ field: "status", op: "ne", value: "done" }])).toBe(3);
  });

  it("keeps only what every field's rows let through", () => {
    expect(count([{ field: "status", op: "gt", value: "todo" }, { field: "type", op: "eq", value: "feature" }])).toBe(2);
  });
});
