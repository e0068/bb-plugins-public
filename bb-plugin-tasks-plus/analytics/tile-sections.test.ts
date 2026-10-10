// @vitest-environment node
// The tiles of the default screen against the numbers the screen's old
// sections gave on the same board (flowOf, before it was removed): the
// tiles must show what the sections showed.
import { describe, expect, it } from "vitest";

import { PROJECT_A, PROJECT_B, smallBoard } from "../test-support/analytics-tasks";
import type { Tile } from "../shared/contract.js";
import { factsOf } from "../shared/task-fields.js";
import { tileAnswer } from "./tile.js";

/** Tasks in any of the statuses: one = row per status. */
const inStatuses = (statuses: readonly string[]): Tile["conditions"] => statuses.map((value) => ({ field: "status", op: "eq", value }));
const DAY = 86_400_000;

const tile = (patch: Partial<Tile>): Tile => ({
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
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
  ...patch,
});

const answer = (patch: Partial<Tile>) =>
  tileAnswer({ ...smallBoard(), tile: tile(patch), projectIds: [], picked: null, facts: factsOf({ projectNames: new Map([[PROJECT_A, "Alpha"], [PROJECT_B, "Beta"]]) }) });

const columnTotals = (values: readonly (readonly number[])[]) => values.map((row) => row.reduce((sum, value) => sum + value, 0));

describe("the default tiles give the old sections' numbers", () => {
  it("Burndown — open tasks at each column's end", () => {
    expect(columnTotals(answer({ breakdown: "status", conditions: inStatuses(["backlog", "todo", "in_progress", "in_review"]) }).values)).toEqual([1, 3, 2, 2, 3, 3, 3]);
  });

  it("Closed — closings per column", () => {
    expect(columnTotals(answer({ y: { metric: "closed", field: null } }).values)).toEqual([0, 0, 1, 0, 0, 1, 0]);
  });

  it("Status changes — moves into done per column", () => {
    const moves = answer({ y: { metric: "moves", field: null }, breakdown: "status" });
    const done = moves.series.findIndex((series) => series.key === "done");
    expect(moves.values.map((row) => row[done])).toEqual([0, 0, 1, 0, 0, 1, 0]);
  });

  it("Created vs closed — both per column", () => {
    const both = answer({ y: { metric: "createdClosed", field: null } });
    expect(both.values.map((row) => row[0])).toEqual([1, 2, 0, 0, 1, 1, 0]);
    expect(both.values.map((row) => row[1])).toEqual([0, 0, 1, 0, 0, 1, 0]);
  });

  it("Cost by project — spend of the tasks closed in the window, largest first", () => {
    const cost = answer({ type: "ring", x: "project", y: { metric: "sum", field: "cost" }, sort: { by: "value", direction: "desc" } });
    expect(cost.columns.map((column, index) => [column.key, cost.values[index]![0]])).toEqual([
      [PROJECT_B, 10],
      [PROJECT_A, 4],
    ]);
  });

  it("Cycle time — median and p90 per estimate", () => {
    const cycle = answer({ type: "bars", x: "estimate", y: { metric: "cycle", field: null } });
    expect(cycle.columns.map((column, index) => [column.key, cycle.values[index]])).toEqual([
      ["s", [2 * DAY, 2 * DAY]],
      ["m", [4 * DAY, 4 * DAY]],
    ]);
  });

  it("Stuck tasks — longest in their status first", () => {
    const stuck = answer({ type: "list", conditions: inStatuses(["todo", "in_progress", "in_review"]), sort: { by: "timeInStatus", direction: "desc" }, limit: 15 });
    expect(stuck.rows.map((row) => row.key)).toEqual(["TSK-2", "TSK-4", "TSK-5"]);
  });

  it("Figures — what came into each status, was made and closed in the window", () => {
    expect(answer({ type: "big", figures: ["open", "done", "created", "closed", "cost", "cycle"] }).figures).toMatchObject({
      open: 5,
      done: 2,
      in_progress: 4,
      in_review: 1,
      created: 5,
      closed: 2,
      cost: 14,
      cycle: 3 * DAY,
    });
  });
});
