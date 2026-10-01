import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TASK_STATUSES, type TaskStatus } from "../db/types.js";
import type { StatusTransition } from "../db/transition-log.js";
import type { Task } from "../shared/contract.js";
import { AGING_LIMIT, flowOf, type FlowInput } from "./flow";

const iso = (ms: number) => new Date(ms).toISOString();

function task(over: Partial<Task> = {}): Task {
  return {
    id: "A",
    projectId: "P",
    number: 1,
    key: "P-1",
    title: "T",
    description: "",
    status: "backlog",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: iso(0),
    updatedAt: iso(0),
    labelIds: [],
    source: null,
    ...over,
  };
}

function move(taskId: string, fromStatus: string | null, toStatus: string, atMs: number, projectId = "P"): StatusTransition {
  return { taskId, projectId, fromStatus, toStatus, atMs, actor: null };
}

const EDGES = [100, 200, 300, 400];

function input(over: Partial<FlowInput> = {}): FlowInput {
  return {
    tasks: [],
    transitions: [],
    edges: EDGES,
    weekEdges: [0, 1000],
    projectIds: [],
    nowMs: 1000,
    ...over,
  };
}

const sum = (counts: Record<TaskStatus, number>) => TASK_STATUSES.reduce((total, status) => total + counts[status], 0);

describe("flowOf — statusByBin: how many tasks stood in each status at the end of each column", () => {
  it("reads a task's status from its last move before the column ends", () => {
    const flow = flowOf(
      input({
        tasks: [task({ status: "done" })],
        transitions: [move("A", "todo", "in_progress", 150), move("A", "in_progress", "done", 250)],
      }),
    );
    const byBin = flow.statusByBin.P!;
    expect(byBin[0]).toMatchObject({ in_progress: 1, done: 0 });
    expect(byBin[1]).toMatchObject({ in_progress: 0, done: 1 });
    expect(byBin[2]).toMatchObject({ done: 1 });
  });

  it("before a task's first move, takes the status that move left", () => {
    const flow = flowOf(input({ tasks: [task({ status: "done" })], transitions: [move("A", "todo", "done", 350)] }));
    expect(flow.statusByBin.P!.map((counts) => counts.todo)).toEqual([1, 1, 0]);
  });

  it("keeps a task without moves in its current status all along", () => {
    const flow = flowOf(input({ tasks: [task({ status: "in_review" })] }));
    expect(flow.statusByBin.P!.map((counts) => counts.in_review)).toEqual([1, 1, 1]);
  });

  it("does not count a task in the columns that end before it was created", () => {
    const flow = flowOf(input({ tasks: [task({ createdAt: iso(250) })] }));
    expect(flow.statusByBin.P!.map(sum)).toEqual([0, 1, 1]);
  });

  it("counts, per project, exactly the tasks created before each column ends", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ created: fc.integer({ min: 0, max: 500 }), project: fc.constantFrom("P", "Q") }), { maxLength: 30 }),
        (specs) => {
          const tasks = specs.map((spec, index) => task({ id: `T${index}`, projectId: spec.project, createdAt: iso(spec.created) }));
          const flow = flowOf(input({ tasks }));
          for (const project of ["P", "Q"]) {
            const counts = (flow.statusByBin[project] ?? EDGES.slice(1).map(() => null)).map((c) => (c === null ? 0 : sum(c)));
            expect(counts).toEqual(EDGES.slice(1).map((end) => specs.filter((s) => s.project === project && s.created < end).length));
          }
        },
      ),
    );
  });
});

describe("flowOf — created and closed per column", () => {
  it("counts creations by createdAt and closings by the last move into done", () => {
    const flow = flowOf(
      input({
        tasks: [task({ id: "A", createdAt: iso(120) }), task({ id: "B", createdAt: iso(130) }), task({ id: "C", createdAt: iso(50) })],
        transitions: [move("C", "in_review", "done", 210), move("A", "todo", "done", 390)],
      }),
    );
    expect(flow.created).toEqual([2, 0, 0]);
    expect(flow.closed).toEqual([0, 1, 1]);
  });
});

describe("flowOf — changes: moves into each status per column", () => {
  it("counts every move by the status it went to", () => {
    const flow = flowOf(
      input({
        tasks: [task()],
        transitions: [move("A", "todo", "in_progress", 110), move("A", "in_progress", "in_review", 120), move("A", "in_review", "done", 310)],
      }),
    );
    expect(flow.changes.map((counts) => sum(counts))).toEqual([2, 0, 1]);
    expect(flow.changes[0]).toMatchObject({ in_progress: 1, in_review: 1 });
    expect(flow.changes[2]).toMatchObject({ done: 1 });
  });
});

describe("flowOf — cycle: in progress to done, per estimate, for tasks closed in the window", () => {
  it("measures from the first move into in progress to the closing", () => {
    const flow = flowOf(
      input({
        tasks: [task({ id: "A", estimate: "s", status: "done" }), task({ id: "B", estimate: "s", status: "done" })],
        transitions: [
          move("A", "todo", "in_progress", 100),
          move("A", "in_progress", "in_review", 150),
          move("A", "in_review", "in_progress", 160),
          move("A", "in_progress", "done", 200),
          move("B", "todo", "in_progress", 100),
          move("B", "in_progress", "done", 390),
        ],
      }),
    );
    expect(flow.cycle).toEqual([{ estimate: "s", count: 2, medianMs: 195, p90Ms: 290 }]);
    expect(flow.medianCycleMs).toBe(195);
  });

  it("leaves estimate rows to estimated tasks seen in progress; the overall median takes every measured one", () => {
    const flow = flowOf(
      input({
        tasks: [task({ id: "A", status: "done" }), task({ id: "B", estimate: "m", status: "done" })],
        transitions: [move("A", "todo", "in_progress", 100), move("A", "in_progress", "done", 200), move("B", "todo", "done", 200)],
      }),
    );
    expect(flow.cycle).toEqual([]);
    expect(flow.medianCycleMs).toBe(100);
  });

  it("has no overall median when no task was measured", () => {
    expect(flowOf(input()).medianCycleMs).toBeNull();
  });

  it("ignores closings outside the columns", () => {
    const flow = flowOf(
      input({
        tasks: [task({ estimate: "xs", status: "done" })],
        transitions: [move("A", "todo", "in_progress", 10), move("A", "in_progress", "done", 50)],
      }),
    );
    expect(flow.cycle).toEqual([]);
  });
});

describe("flowOf — accuracy: planned against actual, per estimate", () => {
  it("gives medians of plan and fact and the median overrun, minutes and money apart", () => {
    const closed = (id: string, over: Partial<Task>) => task({ id, estimate: "m", status: "done", ...over });
    const flow = flowOf(
      input({
        tasks: [
          closed("A", { plannedMinutes: 60, actualMinutes: 120, budget: 2, cost: 3 }),
          closed("B", { plannedMinutes: 60, actualMinutes: 60 }),
          closed("C", { plannedMinutes: 90, actualMinutes: 270 }),
        ],
        transitions: ["A", "B", "C"].map((id) => move(id, "in_review", "done", 250)),
      }),
    );
    expect(flow.accuracy).toEqual([
      {
        estimate: "m",
        minutes: { count: 3, planned: 60, actual: 120, ratio: 2 },
        money: { count: 1, planned: 2, actual: 3, ratio: 1.5 },
      },
    ]);
  });

  it("leaves out an estimate whose closed tasks carry no plan and fact", () => {
    const flow = flowOf(
      input({ tasks: [task({ estimate: "l", status: "done", plannedMinutes: 60 })], transitions: [move("A", "todo", "done", 150)] }),
    );
    expect(flow.accuracy).toEqual([]);
  });
});

describe("flowOf — costByProject: spend of the tasks closed in the window", () => {
  it("sums cost per project, leaves out projects that spent nothing, largest first", () => {
    const flow = flowOf(
      input({
        tasks: [
          task({ id: "A", projectId: "P", cost: 1.25, status: "done" }),
          task({ id: "B", projectId: "P", cost: 2.5, status: "done" }),
          task({ id: "C", projectId: "Q", cost: 9, status: "done" }),
          task({ id: "D", projectId: "R", cost: null, status: "done" }),
        ],
        transitions: [
          move("A", "todo", "done", 150, "P"),
          move("B", "todo", "done", 250, "P"),
          move("C", "todo", "done", 350, "Q"),
          move("D", "todo", "done", 350, "R"),
        ],
      }),
    );
    expect(flow.costByProject).toEqual([
      { projectId: "Q", cost: 9 },
      { projectId: "P", cost: 3.75 },
    ]);
  });
});

describe("flowOf — typesByWeek: closings per week and type", () => {
  it("counts each closing in its week under its type, untyped apart", () => {
    const flow = flowOf(
      input({
        weekEdges: [0, 500, 1000],
        tasks: [task({ id: "A", type: "feature" }), task({ id: "B", type: "bugfix" }), task({ id: "C" })],
        transitions: [move("A", "todo", "done", 100), move("B", "todo", "done", 600), move("C", "todo", "done", 700)],
      }),
    );
    expect(flow.typesByWeek[0]).toMatchObject({ feature: 1, bugfix: 0, untyped: 0 });
    expect(flow.typesByWeek[1]).toMatchObject({ feature: 0, bugfix: 1, untyped: 1 });
  });
});

describe("flowOf — aging: open tasks that stand longest in their status", () => {
  it("dates a task by its last move into its current status, else by its creation", () => {
    const flow = flowOf(
      input({
        tasks: [
          task({ id: "A", status: "in_progress", createdAt: iso(10) }),
          task({ id: "B", status: "in_review", createdAt: iso(5) }),
          task({ id: "C", status: "backlog", createdAt: iso(1) }),
          task({ id: "D", status: "done", createdAt: iso(1) }),
        ],
        transitions: [move("A", "todo", "in_progress", 300), move("B", "in_progress", "in_review", 200)],
      }),
    );
    expect(flow.aging).toEqual([
      { taskId: "B", projectId: "P", status: "in_review", sinceMs: 200 },
      { taskId: "A", projectId: "P", status: "in_progress", sinceMs: 300 },
    ]);
  });

  it("keeps at most the limit", () => {
    const tasks = Array.from({ length: AGING_LIMIT + 5 }, (_, index) => task({ id: `T${index}`, status: "todo", createdAt: iso(index) }));
    expect(flowOf(input({ tasks })).aging).toHaveLength(AGING_LIMIT);
  });
});

describe("flowOf — projectIds narrows everything to those projects", () => {
  it("drops other projects' tasks and moves", () => {
    const flow = flowOf(
      input({
        projectIds: ["Q"],
        tasks: [task({ id: "A", projectId: "P", createdAt: iso(150) }), task({ id: "B", projectId: "Q", createdAt: iso(150) })],
        transitions: [move("A", "todo", "done", 250, "P")],
      }),
    );
    expect(Object.keys(flow.statusByBin)).toEqual(["Q"]);
    expect(flow.created).toEqual([1, 0, 0]);
    expect(flow.closed).toEqual([0, 0, 0]);
  });
});

describe("flowOf — total on degenerate input", () => {
  it("gives no columns for fewer than two edges and never throws", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 1 }), (edges) => {
        const flow = flowOf(input({ edges, tasks: [task({ createdAt: "not a date" })] }));
        expect(flow.created).toEqual([]);
        expect(flow.statusByBin.P ?? []).toEqual([]);
      }),
    );
  });
});

describe("flowOf — edges that do not rise make no columns for any chart", () => {
  it("answers every per-column chart with nothing rather than half of them with counts", () => {
    const flow = flowOf(
      input({
        edges: [300, 200, 100],
        tasks: [task({ createdAt: iso(150), status: "done" })],
        transitions: [move("A", "todo", "done", 250)],
      }),
    );
    expect(flow.created).toEqual([]);
    expect(flow.closed).toEqual([]);
    expect(flow.changes).toEqual([]);
    expect(flow.statusByBin.P).toEqual([]);
  });
});
