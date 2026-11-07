// @vitest-environment node
import { describe, expect, it } from "vitest";

import { aTask, smallBoard } from "../test-support/analytics-tasks";
import type { Tile } from "../shared/contract.js";
import { factsOf } from "../shared/task-fields.js";
import { tileAnswer } from "./tile.js";

const tile = (patch: Partial<Tile>): Tile => ({
  id: "t",
  type: "columns",
  title: "T",
  window: "page",
  x: "threads",
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

const board = smallBoard();
const [first, second] = board.tasks;
const facts = factsOf({
  threadTitles: new Map([
    [first!.id, ["Fix the chart", "Review"]],
    [second!.id, ["Review"]],
  ]),
});
const answer = (patch: Partial<Tile>) =>
  tileAnswer({ tile: tile(patch), tasks: board.tasks, transitions: board.transitions, edges: board.edges, projectIds: [], picked: null, nowMs: board.nowMs, facts });
const countsByLabel = (patch: Partial<Tile>) => {
  const result = answer(patch);
  return Object.fromEntries(result.columns.map((column, index) => [column.label, result.values[index]![0]]));
};

describe("tileAnswer over the Assignee field — the threads of a task", () => {
  it("puts a task under each of its threads, and a task with none under None", () => {
    expect(countsByLabel({})).toEqual({ "Fix the chart": 1, Review: 2, None: board.tasks.length - 2 });
  });

  it("counts a task once under a title two of its threads share", () => {
    const twice = factsOf({ threadTitles: new Map([[first!.id, ["Review", "Review"]]]) });
    const result = tileAnswer({ tile: tile({}), tasks: [first!], transitions: [], edges: board.edges, projectIds: [], picked: null, nowMs: board.nowMs, facts: twice });
    expect(result.columns.map((column, index) => [column.label, result.values[index]![0]])).toEqual([["Review", 1]]);
  });

  it("filters by a thread title the same way", () => {
    const only = answer({ x: "status", conditions: [{ field: "threads", op: "eq", value: "Review" }] });
    expect(only.total).toBe(2);
  });

  it("a task the facts know no thread of is unassigned", () => {
    const lone = tileAnswer({ tile: tile({}), tasks: [aTask(99, {})], transitions: [], edges: board.edges, projectIds: [], picked: null, nowMs: board.nowMs, facts: factsOf({}) });
    expect(lone.columns.map((column) => column.label)).toEqual(["None"]);
  });
});
