// @vitest-environment node
// A «Big numbers» tile follows its period: every figure reads only what
// happened inside the window — the statuses tasks came into, the tasks made,
// the tasks closed and their time and money.
import { describe, expect, it } from "vitest";

import { aMove, aTask, oct } from "../test-support/analytics-tasks";
import { FIGURES } from "../shared/analytics-tile.js";
import type { Tile } from "../shared/contract.js";
import { factsOf } from "../shared/task-fields.js";
import { tileAnswer } from "./tile.js";

const tile: Tile = {
  id: "t",
  type: "big",
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
  figures: [...FIGURES],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
};

/**
 * Two weeks of October: an old task closed in the first, one closed in the
 * second, one taken into work in the second, one reopened in the second, one
 * made in the second and sent to review.
 */
const money = { plannedMinutes: 60, actualMinutes: 90, budget: 10, budgetLimit: 20, cost: 5 };
const oldClosed = aTask(1, { status: "done", ...money, createdAt: new Date(oct(1, 9)).toISOString() });
const lateClosed = aTask(2, { status: "done", plannedMinutes: 30, actualMinutes: 45, budget: 3, budgetLimit: 4, cost: 2, createdAt: new Date(oct(2, 9)).toISOString() });
const taken = aTask(3, { status: "in_progress", ...money, createdAt: new Date(oct(2, 10)).toISOString() });
const reopened = aTask(4, { status: "todo", ...money, createdAt: new Date(oct(3, 9)).toISOString() });
const fresh = aTask(5, { status: "in_review", ...money, createdAt: new Date(oct(9, 9)).toISOString() });
const board = {
  tasks: [oldClosed, lateClosed, taken, reopened, fresh],
  transitions: [
    aMove(oldClosed, "todo", "in_progress", oct(2, 12)),
    aMove(oldClosed, "in_progress", "done", oct(4, 12)),
    aMove(reopened, "todo", "done", oct(5, 12)),
    aMove(lateClosed, "todo", "in_progress", oct(8, 12)),
    aMove(lateClosed, "in_progress", "done", oct(10, 12)),
    aMove(taken, "todo", "in_progress", oct(9, 12)),
    aMove(reopened, "done", "todo", oct(10, 12)),
    aMove(fresh, "todo", "in_progress", oct(9, 13)),
    aMove(fresh, "in_progress", "in_review", oct(11, 12)),
  ],
  nowMs: oct(15),
};

const answerIn = (fromDay: number, toDay: number, patch: Partial<Parameters<typeof tileAnswer>[0]> = {}) =>
  tileAnswer({
    ...board,
    edges: Array.from({ length: toDay - fromDay + 1 }, (_, day) => oct(fromDay + day)),
    tile,
    projectIds: [],
    picked: null,
    facts: factsOf({ projectNames: new Map() }),
    ...patch,
  });
const figuresIn = (fromDay: number, toDay: number) => answerIn(fromDay, toDay).figures;

describe("«Big numbers» over the period", () => {
  it("the second week — only what came into each status, and the money of what closed", () => {
    expect(figuresIn(8, 15)).toEqual({
      open: 2,
      in_progress: 3,
      in_review: 1,
      done: 1,
      created: 1,
      closed: 1,
      cycle: 2 * 86_400_000,
      planned: 30,
      actual: 45,
      budget: 3,
      cost: 2,
      limit: 4,
    });
  });

  it("the first week — the old closing and the tasks made then", () => {
    expect(figuresIn(1, 8)).toMatchObject({ open: 4, in_progress: 1, in_review: 0, done: 2, created: 4, closed: 2, planned: 120, budget: 20, cost: 10, limit: 40 });
  });

  it("the whole month — Done counts a task closed and reopened, Closed only what stays closed", () => {
    expect(figuresIn(1, 15)).toMatchObject({ done: 3, closed: 2 });
  });

  it("a period with nothing in it — zeroes, no cycle", () => {
    expect(figuresIn(12, 15)).toEqual({ open: 0, in_progress: 0, in_review: 0, done: 0, created: 0, closed: 0, cycle: null, planned: 0, actual: 0, budget: 0, cost: 0, limit: 0 });
  });
});

describe("«Big numbers» — what the sums are made of", () => {
  const costed = aTask(11, { status: "done", budget: 10, budgetLimit: 20, cost: 5, plannedMinutes: 30, createdAt: new Date(oct(1, 9)).toISOString() });
  const bare = aTask(12, { status: "done", budget: 20, budgetLimit: 40, createdAt: new Date(oct(1, 9)).toISOString() });
  const two = {
    tasks: [costed, bare],
    transitions: [aMove(costed, "in_progress", "done", oct(3, 12)), aMove(bare, "in_progress", "done", oct(4, 12))],
  };

  it("counts the closed tasks carrying each sum, and compares the cost with the budget of the same tasks", () => {
    const answer = answerIn(1, 8, two);
    expect(answer.figures).toMatchObject({ closed: 2, budget: 30, cost: 5 });
    expect(answer.sums).toEqual({ carriers: { planned: 1, actual: 0, budget: 2, cost: 1, limit: 2 }, paired: { cost: 5, budget: 10 } });
  });

  it("a tile that is not «Big numbers» carries no sums", () => {
    expect(answerIn(1, 8, { ...two, tile: { ...tile, type: "columns" } }).sums).toBeUndefined();
  });
});

describe("The page's filters", () => {
  it("narrow every figure to the tasks they keep", () => {
    const filters = { statuses: ["done" as const], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] };
    expect(answerIn(8, 15, { filters }).figures).toMatchObject({ open: 0, in_progress: 1, in_review: 0, done: 1, closed: 1, budget: 3 });
  });

  it("keep a project picked in the Project filter", () => {
    const other = aTask(21, { status: "done", projectId: "other", budget: 100, createdAt: new Date(oct(9, 9)).toISOString() });
    const filters = { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [], values: { project: ["other"] } };
    const answer = answerIn(8, 15, { tasks: [...board.tasks, other], transitions: [...board.transitions, aMove(other, "todo", "done", oct(10, 9))], filters });
    expect(answer.figures).toMatchObject({ created: 1, closed: 1, budget: 100 });
  });
});

describe("A task's creation on the page", () => {
  it("is no later than its first move the log recorded — git rewriting the file does not make it new", () => {
    const rewritten = aTask(31, { status: "in_progress", createdAt: new Date(oct(9, 9)).toISOString() });
    const answer = answerIn(8, 15, { tasks: [rewritten], transitions: [aMove(rewritten, "todo", "in_progress", oct(5, 12))] });
    expect(answer.figures).toMatchObject({ created: 0, open: 0 });
  });
});
