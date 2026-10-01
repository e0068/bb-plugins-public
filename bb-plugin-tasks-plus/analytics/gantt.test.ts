import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TASK_STATUSES, type TaskStatus } from "../db/types.js";
import type { StatusTransition } from "../db/transition-log.js";
import type { Task } from "../shared/contract.js";
import { movesByTask } from "./flow.js";
import { ganttRowsOf, ganttSegmentsOf } from "./gantt.js";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);

const task = (id: string, status: TaskStatus, createdMs = T0, over: Partial<Task> = {}) =>
  ({ id, projectId: "P", status, createdAt: new Date(createdMs).toISOString(), startDate: null, dueDate: null, ...over }) as Task;
const move = (taskId: string, fromStatus: string | null, toStatus: string, atMs: number, projectId = "P"): StatusTransition => ({
  taskId,
  projectId,
  fromStatus,
  toStatus,
  atMs,
  actor: null,
});

describe("ganttSegmentsOf — a task's life by status", () => {
  it("runs from creation through each move, stopping when the task is done", () => {
    const moves = [move("a", "todo", "in_progress", T0 + 2 * HOUR), move("a", "in_progress", "in_review", T0 + 5 * HOUR), move("a", "in_review", "done", T0 + 6 * HOUR)];
    expect(ganttSegmentsOf(task("a", "done"), moves, T0 + 10 * HOUR)).toEqual([
      { status: "todo", fromMs: T0, toMs: T0 + 2 * HOUR },
      { status: "in_progress", fromMs: T0 + 2 * HOUR, toMs: T0 + 5 * HOUR },
      { status: "in_review", fromMs: T0 + 5 * HOUR, toMs: T0 + 6 * HOUR },
    ]);
  });

  it("stretches an open task's last status to now", () => {
    expect(ganttSegmentsOf(task("a", "in_progress"), [move("a", "todo", "in_progress", T0 + HOUR)], T0 + 3 * HOUR)).toEqual([
      { status: "todo", fromMs: T0, toMs: T0 + HOUR },
      { status: "in_progress", fromMs: T0 + HOUR, toMs: T0 + 3 * HOUR },
    ]);
  });

  it("stands a never-moved task in its status all its life", () => {
    expect(ganttSegmentsOf(task("a", "backlog"), [], T0 + HOUR)).toEqual([{ status: "backlog", fromMs: T0, toMs: T0 + HOUR }]);
    expect(ganttSegmentsOf(task("a", "done"), [], T0 + HOUR)).toEqual([]);
  });

  it("picks a reopened task up again after the gap it stood done", () => {
    const moves = [move("a", "in_progress", "done", T0 + HOUR), move("a", "done", "in_progress", T0 + 3 * HOUR)];
    expect(ganttSegmentsOf(task("a", "in_progress"), moves, T0 + 4 * HOUR)).toEqual([
      { status: "in_progress", fromMs: T0, toMs: T0 + HOUR },
      { status: "in_progress", fromMs: T0 + 3 * HOUR, toMs: T0 + 4 * HOUR },
    ]);
  });

  it("gives ordered, non-overlapping segments inside the task's life, never done or canceled", () => {
    const statusArb = fc.constantFrom(...TASK_STATUSES);
    fc.assert(
      fc.property(
        statusArb,
        fc.array(fc.tuple(statusArb, fc.integer({ min: 0, max: 100 * HOUR })), { maxLength: 12 }),
        (initial, steps) => {
          const moves = steps
            .map(([status, offset]) => ({ status, atMs: T0 + offset }))
            .sort((a, b) => a.atMs - b.atMs)
            .map(({ status, atMs }, index, all) => move("a", index === 0 ? initial : all[index - 1]!.status, status, atMs));
          const nowMs = T0 + 101 * HOUR;
          const current = moves.at(-1)?.toStatus ?? initial;
          const segments = ganttSegmentsOf(task("a", current as TaskStatus), moves, nowMs);
          segments.forEach((segment, index) => {
            expect(segment.fromMs).toBeLessThan(segment.toMs);
            expect(segment.fromMs).toBeGreaterThanOrEqual(T0);
            expect(segment.toMs).toBeLessThanOrEqual(nowMs);
            expect(["done", "canceled"]).not.toContain(segment.status);
            if (index > 0) expect(segment.fromMs).toBeGreaterThanOrEqual(segments[index - 1]!.toMs);
          });
        },
      ),
    );
  });
});

describe("ganttRowsOf — the tasks a Gantt from a moment draws", () => {
  const nowMs = T0 + 10 * HOUR;

  it("keeps the tasks alive after the start, their stretches cut at it", () => {
    const tasks = [
      task("late", "in_progress", T0 + 6 * HOUR),
      task("early", "in_progress", T0),
      task("gone", "done", T0),
    ];
    const transitions = [move("gone", "in_progress", "done", T0 + HOUR)];
    const rows = ganttRowsOf({ tasks, moves: movesByTask(transitions), projectIds: [], fromMs: T0 + 4 * HOUR, nowMs });
    expect(rows.map((row) => row.task.id).sort()).toEqual(["early", "late"]);
    expect(rows.find((row) => row.task.id === "early")!.segments).toEqual([{ status: "in_progress", fromMs: T0 + 4 * HOUR, toMs: nowMs }]);
  });

  it("keeps a task with planned dates even when it lived before the start", () => {
    const tasks = [task("planned", "done", T0, { dueDate: "2026-09-30" })];
    const transitions = [move("planned", "in_progress", "done", T0 + HOUR)];
    const rows = ganttRowsOf({ tasks, moves: movesByTask(transitions), projectIds: [], fromMs: T0 + 4 * HOUR, nowMs });
    expect(rows.map((row) => [row.task.id, row.segments])).toEqual([["planned", []]]);
  });

  it("keeps only the projects asked for", () => {
    const tasks = [task("a", "todo"), { ...task("b", "todo"), projectId: "Q" }];
    expect(ganttRowsOf({ tasks, moves: new Map(), projectIds: ["Q"], fromMs: T0, nowMs }).map((row) => row.task.id)).toEqual(["b"]);
  });
});
