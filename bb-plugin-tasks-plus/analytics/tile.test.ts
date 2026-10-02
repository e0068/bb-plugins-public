// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { aMove, aTask, oct, PROJECT_A, PROJECT_B } from "../test-support/analytics-tasks";
import type { Task, Tile } from "../shared/contract.js";
import { TASK_STATUSES, TASK_TYPES } from "../shared/enums.js";
import { factsOf } from "../shared/task-fields.js";
import type { StatusTransition } from "../db/transition-log.js";
import { tileAnswer, type TileInput } from "./tile.js";

/** Tasks in any of the statuses: one = row per status. */
const inStatuses = (statuses: readonly string[]): Tile["conditions"] => statuses.map((value) => ({ field: "status", op: "eq", value }));

const tile = (patch: Partial<Tile> = {}): Tile => ({
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

/** Seven daily columns, Oct 1 – Oct 8. */
const EDGES = Array.from({ length: 8 }, (_, day) => oct(day + 1));
const NOW = oct(8);

const facts = factsOf({
  projectNames: new Map([[PROJECT_A, "Alpha"], [PROJECT_B, "Beta"]]),
  labelNames: new Map([["L1", "ui"], ["L2", "chart"]]),
});

const input = (patch: Partial<TileInput>): TileInput => ({
  tile: tile(),
  tasks: [],
  transitions: [],
  edges: EDGES,
  projectIds: [],
  picked: null,
  nowMs: NOW,
  facts,
  ...patch,
});

const sum = (rows: readonly (readonly number[])[]) => rows.flat().reduce((total, value) => total + value, 0);

/* A small board: tasks made through the week, moved, some closed. */
const t1 = aTask(1, { status: "done", type: "feature", estimate: "s", cost: 4, createdAt: new Date(oct(1, 9)).toISOString() });
const t2 = aTask(2, { status: "in_progress", type: "bugfix", estimate: "m", createdAt: new Date(oct(2, 9)).toISOString() });
const t3 = aTask(3, { status: "done", type: "bugfix", estimate: "m", cost: 10, projectId: PROJECT_B, createdAt: new Date(oct(2, 10)).toISOString() });
const t4 = aTask(4, { status: "todo", projectId: PROJECT_B, labelIds: ["L1", "L2"], createdAt: new Date(oct(5, 9)).toISOString() });
const t5 = aTask(5, { status: "in_review", type: "feature", createdAt: new Date(oct(6, 9)).toISOString() });
const BOARD: Task[] = [t1, t2, t3, t4, t5];
const MOVES: StatusTransition[] = [
  aMove(t1, "todo", "in_progress", oct(1, 12)),
  aMove(t1, "in_progress", "done", oct(3, 12)),
  aMove(t2, "todo", "in_progress", oct(4, 12)),
  aMove(t3, "todo", "in_progress", oct(2, 12)),
  aMove(t3, "in_progress", "done", oct(6, 12)),
  aMove(t5, "todo", "in_progress", oct(6, 12)),
  aMove(t5, "in_progress", "in_review", oct(7, 12)),
];
const board = (patch: Partial<TileInput>) => input({ tasks: BOARD, transitions: MOVES, ...patch });

describe("tileAnswer — counting by a field", () => {
  const anyTasks = fc
    .array(
      fc.record({
        status: fc.constantFrom(...TASK_STATUSES),
        type: fc.option(fc.constantFrom(...TASK_TYPES), { nil: null }),
        projectId: fc.constantFrom(PROJECT_A, PROJECT_B),
      }),
      { maxLength: 30 },
    )
    .map((patches) => patches.map((patch, index) => aTask(index + 1, patch)));

  it("counts every task kept by the filter exactly once", () => {
    fc.assert(
      fc.property(anyTasks, fc.constantFrom("status", "type", "project"), (tasks, x) => {
        const answer = tileAnswer(input({ tasks, tile: tile({ x: x as Tile["x"], limit: 200 }) }));
        expect(sum(answer.values)).toBe(tasks.length);
        expect(answer.total).toBe(tasks.length);
      }),
    );
  });

  it("is not changed by a filter that keeps every task", () => {
    fc.assert(
      fc.property(anyTasks, (tasks) => {
        const open = tileAnswer(input({ tasks, tile: tile({ x: "status", breakdown: "project" }) }));
        const all = tileAnswer(input({ tasks, tile: tile({ x: "status", breakdown: "project", conditions: inStatuses(TASK_STATUSES) }) }));
        expect(all).toEqual(open);
      }),
    );
  });

  it("puts a task under each of its labels, and a task without one under None", () => {
    const answer = tileAnswer(board({ tile: tile({ x: "labels" }) }));
    const byKey = Object.fromEntries(answer.columns.map((column, index) => [column.label, answer.values[index]![0]]));
    expect(byKey).toEqual({ ui: 1, chart: 1, None: 4 });
  });

  it("names projects by their names and splits columns by the breakdown", () => {
    const answer = tileAnswer(board({ tile: tile({ x: "project", breakdown: "status" }) }));
    expect(answer.columns.map((column) => column.label)).toEqual(["Alpha", "Beta"]);
    expect(answer.series.map((series) => series.key)).toEqual(["todo", "in_progress", "in_review", "done"]);
    expect(answer.values).toEqual([
      [0, 1, 1, 1],
      [1, 0, 0, 1],
    ]);
    expect(answer.cells[0]![3]).toEqual(["TSK-1"]);
  });
});

describe("tileAnswer — switch, sort and limit", () => {
  it("lists the switch values with their counts and narrows to the picked one", () => {
    const all = tileAnswer(board({ tile: tile({ x: "status", switch: "project" }) }));
    expect(all.switchValues).toEqual([
      { key: PROJECT_A, label: "Alpha", count: 3 },
      { key: PROJECT_B, label: "Beta", count: 2 },
    ]);
    const beta = tileAnswer(board({ tile: tile({ x: "status", switch: "project" }), picked: PROJECT_B }));
    expect(beta.total).toBe(2);
  });

  it("orders categories by their value when asked, and gathers the tail into Other", () => {
    const answer = tileAnswer(board({ tile: tile({ x: "key", y: { metric: "sum", field: "cost" }, sort: { by: "value", direction: "desc" }, limit: 1 }) }));
    expect(answer.columns.map((column) => column.label)).toEqual(["TSK-3", "Other"]);
    expect(answer.values).toEqual([[10], [4]]);
  });

  it("orders categories by the first task under a field sort", () => {
    const answer = tileAnswer(board({ tile: tile({ x: "key", sort: { by: "createdAt", direction: "desc" } }) }));
    expect(answer.columns.map((column) => column.label)).toEqual(["TSK-5", "TSK-4", "TSK-3", "TSK-2", "TSK-1"]);
  });
});

describe("tileAnswer — rows and figures", () => {
  it("draws the Gantt rows for bars that run Start to Due", () => {
    const planned = aTask(9, { startDate: "2026-10-03T15:00", dueDate: "2026-10-03T17:00" });
    const answer = tileAnswer(input({ tasks: [planned], tile: tile({ type: "bars", bars: { length: "range", gantt: "plan" } }) }));
    expect(answer.rows.map((row) => [row.key, row.startDate, row.dueDate])).toEqual([["TSK-9", "2026-10-03T15:00", "2026-10-03T17:00"]]);
  });

});
