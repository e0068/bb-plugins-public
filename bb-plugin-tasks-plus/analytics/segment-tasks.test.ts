// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { aTask, oct, PROJECT_A, PROJECT_B } from "../test-support/analytics-tasks";
import type { Task, Tile } from "../shared/contract.js";
import { TASK_STATUSES } from "../shared/enums.js";
import { factsOf } from "../shared/task-fields.js";
import { segmentTasks, tileAnswer, type TileInput } from "./tile.js";

const tile = (patch: Partial<Tile> = {}): Tile => ({
  id: "t",
  type: "columns",
  title: "T",
  window: "page",
  x: "status",
  y: { metric: "count", field: null },
  breakdown: "project",
  switch: null,
  conditions: [],
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
  ...patch,
});

const facts = factsOf({ projectNames: new Map([[PROJECT_A, "Alpha"], [PROJECT_B, "Beta"]]) });

const input = (tasks: readonly Task[], patch: Partial<TileInput> = {}): TileInput => ({
  tile: tile(),
  tasks,
  transitions: [],
  edges: Array.from({ length: 8 }, (_, day) => oct(day + 1)),
  projectIds: [],
  picked: null,
  nowMs: oct(8),
  facts,
  ...patch,
});

const anyBoard = fc
  .array(
    fc.record({
      status: fc.constantFrom(...TASK_STATUSES),
      projectId: fc.constantFrom(PROJECT_A, PROJECT_B),
      cost: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    }),
    { maxLength: 30 },
  )
  .map((rows) => rows.map((row, index) => aTask(index + 1, row)));

const keys = (tasks: readonly Task[]) => tasks.map((task) => task.key);

describe("segmentTasks — the tasks behind a pick", () => {
  it("counts every task of the pick whatever the limit and the sort", () => {
    fc.assert(
      fc.property(anyBoard, fc.integer({ min: 1, max: 40 }), fc.constantFrom("asc" as const, "desc" as const), (board, limit, direction) => {
        const all = segmentTasks(input(board), null, null, 500);
        const cut = segmentTasks(input(board), null, { column: "cost", direction }, limit);
        expect(cut.total).toBe(all.total);
        expect(cut.tasks.length).toBe(Math.min(limit, all.total));
      }),
    );
  });

  it("lists a segment's tasks inside its column's, and the column's inside the chart's", () => {
    fc.assert(
      fc.property(anyBoard, (board) => {
        const answer = tileAnswer(input(board));
        const chart = new Set(keys(segmentTasks(input(board), null, null, 500).tasks));
        answer.columns.forEach((_, column) => {
          const whole = keys(segmentTasks(input(board), { column, series: null }, null, 500).tasks);
          whole.forEach((key) => expect(chart.has(key)).toBe(true));
          answer.series.forEach((series) => {
            const part = keys(segmentTasks(input(board), { column, series: series.key }, null, 500).tasks);
            part.forEach((key) => expect(whole).toContain(key));
          });
        });
      }),
    );
  });

  it("lists exactly the tasks a segment counts", () => {
    fc.assert(
      fc.property(anyBoard, (board) => {
        const answer = tileAnswer(input(board));
        answer.columns.forEach((_, column) =>
          answer.series.forEach((series, index) =>
            expect(segmentTasks(input(board), { column, series: series.key }, null, 500).total).toBe(answer.values[column]![index]),
          ),
        );
      }),
    );
  });

  it("orders by the field asked, each task once, by key when unsorted", () => {
    const board = [
      aTask(3, { status: "todo", cost: 5 }),
      aTask(1, { status: "todo", cost: 20 }),
      aTask(2, { status: "done", cost: 1, projectId: PROJECT_B }),
    ];
    expect(keys(segmentTasks(input(board), null, null, 10).tasks)).toEqual(["TSK-1", "TSK-2", "TSK-3"]);
    expect(keys(segmentTasks(input(board), null, { column: "cost", direction: "desc" }, 10).tasks)).toEqual(["TSK-1", "TSK-3", "TSK-2"]);
    expect(keys(segmentTasks(input(board), null, { column: "cost", direction: "asc" }, 2).tasks)).toEqual(["TSK-2", "TSK-3"]);
  });

  it("lists nothing for a column past the chart's or a series it does not have", () => {
    const board = [aTask(1, { status: "todo" })];
    expect(segmentTasks(input(board), { column: 9, series: null }, null, 10)).toEqual({ tasks: [], total: 0 });
    expect(segmentTasks(input(board), { column: 0, series: "nobody" }, null, 10)).toEqual({ tasks: [], total: 0 });
  });
});
