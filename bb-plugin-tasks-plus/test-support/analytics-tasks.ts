// Builders of tasks and status moves for the analytics core's tests: a
// complete task by number with only what a test is about set, and a move.
import type { StatusTransition } from "../db/transition-log.js";
import type { Task } from "../shared/contract.js";

export const PROJECT_A = "01HZZZZZZZZZZZZZZZZZZZZZPA";
export const PROJECT_B = "01HZZZZZZZZZZZZZZZZZZZZZPB";

/** Local midnight of a day of October 2026 — the month the tests live in. */
export const oct = (day: number, hour = 0) => new Date(2026, 9, day, hour).getTime();

export function aTask(number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZT${String(number).padStart(2, "0")}`,
    projectId: PROJECT_A,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
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
    position: number,
    createdAt: new Date(oct(1)).toISOString(),
    updatedAt: new Date(oct(1)).toISOString(),
    labelIds: [],
    source: null,
    ...patch,
  } as Task;
}

export const aMove = (task: Task, fromStatus: string | null, toStatus: string, atMs: number): StatusTransition => ({
  taskId: task.id,
  projectId: task.projectId,
  fromStatus,
  toStatus,
  atMs,
  actor: null,
});

/**
 * A small board for the analytics core: five tasks made through the first
 * week of October 2026, two closed, one in progress, one in review, one to
 * do, across two projects.
 */
export function smallBoard() {
  const t1 = aTask(1, { status: "done", type: "feature", estimate: "s", cost: 4, createdAt: new Date(oct(1, 9)).toISOString() });
  const t2 = aTask(2, { status: "in_progress", type: "bugfix", estimate: "m", createdAt: new Date(oct(2, 9)).toISOString() });
  const t3 = aTask(3, { status: "done", type: "bugfix", estimate: "m", cost: 10, projectId: PROJECT_B, createdAt: new Date(oct(2, 10)).toISOString() });
  const t4 = aTask(4, { status: "todo", projectId: PROJECT_B, labelIds: ["L1", "L2"], createdAt: new Date(oct(5, 9)).toISOString() });
  const t5 = aTask(5, { status: "in_review", type: "feature", createdAt: new Date(oct(6, 9)).toISOString() });
  return {
    tasks: [t1, t2, t3, t4, t5],
    transitions: [
      aMove(t1, "todo", "in_progress", oct(1, 12)),
      aMove(t1, "in_progress", "done", oct(3, 12)),
      aMove(t2, "todo", "in_progress", oct(4, 12)),
      aMove(t3, "todo", "in_progress", oct(2, 12)),
      aMove(t3, "in_progress", "done", oct(6, 12)),
      aMove(t5, "todo", "in_progress", oct(6, 12)),
      aMove(t5, "in_progress", "in_review", oct(7, 12)),
    ],
    /** Seven daily columns, Oct 1 – Oct 8, read on Oct 8. */
    edges: Array.from({ length: 8 }, (_, day) => oct(day + 1)),
    nowMs: oct(8),
  };
}
