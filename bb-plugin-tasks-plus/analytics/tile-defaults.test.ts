// @vitest-environment node
// The tiles the screen opens with, taken from defaultDashboard() itself, on
// the small board: the numbers the screen's old sections gave there.
import { describe, expect, it } from "vitest";

import { PROJECT_A, PROJECT_B, smallBoard } from "../test-support/analytics-tasks";
import { defaultDashboard } from "../views/analytics/default-dashboard";
import { factsOf } from "../shared/task-fields.js";
import { tileAnswer } from "./tile.js";

const DAY = 86_400_000;
const tiles = new Map(defaultDashboard().tiles.map((tile) => [tile.id, tile]));

const answer = (id: string, projectIds: readonly string[] = []) =>
  tileAnswer({
    ...smallBoard(),
    tile: tiles.get(id)!,
    projectIds,
    picked: null,
    facts: factsOf({ projectNames: new Map([[PROJECT_A, "Alpha"], [PROJECT_B, "Beta"]]) }),
  });

const totals = (values: readonly (readonly number[])[]) => values.map((row) => row.reduce((sum, value) => sum + value, 0));

describe("the default tiles on the small board", () => {
  it("Burndown — open tasks at each column's end, narrowed by the page's projects", () => {
    expect(totals(answer("burndown").values)).toEqual([1, 3, 2, 2, 3, 3, 3]);
    expect(totals(answer("burndown", [PROJECT_B]).values)).toEqual([0, 1, 1, 1, 2, 1, 1]);
  });

  it("Work in progress — in progress and in review at each column's end", () => {
    expect(totals(answer("wip").values)).toEqual([1, 2, 1, 2, 2, 2, 2]);
  });

  it("Status changes, the closed charts and Created vs closed", () => {
    expect(totals(answer("changes").values)).toEqual([1, 1, 1, 1, 0, 2, 1]);
    expect(totals(answer("closed-daily").values)).toEqual([0, 0, 1, 0, 0, 1, 0]);
    expect(totals(answer("closed-hourly").values)).toEqual([0, 0, 1, 0, 0, 1, 0]);
    const both = answer("created-closed");
    expect(both.values.map((row) => row[0])).toEqual([1, 2, 0, 0, 1, 1, 0]);
    expect(both.values.map((row) => row[1])).toEqual([0, 0, 1, 0, 0, 1, 0]);
  });

  it("Closed by type — a feature, then a bugfix", () => {
    const types = answer("types");
    expect(types.series.map((series) => series.key)).toEqual(["feature", "bugfix"]);
    expect(types.values.filter((row) => row.some((value) => value > 0))).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("Cost by project, Cycle time and Stuck tasks", () => {
    const cost = answer("cost");
    expect(cost.columns.map((column, index) => [column.key, cost.values[index]![0]])).toEqual([
      [PROJECT_B, 10],
      [PROJECT_A, 4],
    ]);
    const cycle = answer("cycle");
    expect(cycle.values).toEqual([
      [2 * DAY, 2 * DAY],
      [4 * DAY, 4 * DAY],
    ]);
    expect(answer("aging").rows.map((row) => row.key)).toEqual(["TSK-2", "TSK-4", "TSK-5"]);
  });

  it("the figure tiles", () => {
    expect(answer("work").figures).toMatchObject({ open: 3, in_progress: 1, in_review: 1, done: 2 });
    expect(answer("period").figures).toMatchObject({ created: 5, closed: 2, cycle: 3 * DAY });
    expect(answer("money").figures).toMatchObject({ cost: 14 });
  });
});
