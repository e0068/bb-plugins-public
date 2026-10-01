// Pure core of the Gantt charts: the stretches of a task's life by status,
// read off the transition log the way the flow charts read it (flow.ts), and
// the tasks a Gantt from a given moment draws. No I/O, no clock — the RPC
// handler (api/index.ts) hands in the tasks, their moves and "now". Planned
// dates travel as the task's own calendar strings: only the viewer's client
// knows which local day they are.
import { TASK_STATUSES, type TaskStatus } from "../db/types.js";
import type { StatusTransition } from "../db/transition-log.js";
import type { Task } from "../shared/contract.js";
import { createdMs, inProjects, statusBefore } from "./flow.js";

/** A stretch of a task's life in one status: `[fromMs, toMs)`. */
export interface GanttSegment {
  status: TaskStatus;
  fromMs: number;
  toMs: number;
}

/** A task on a Gantt and the stretches of it the Gantt shows. */
export interface GanttRow {
  task: Task;
  segments: GanttSegment[];
}

/** Statuses that end the work: a Gantt bar stops where the task enters one. */
const FINISHED: ReadonlySet<TaskStatus> = new Set(["done", "canceled"]);

const isStatus = (value: string | null): value is TaskStatus => TASK_STATUSES.includes(value as TaskStatus);

/**
 * The task's life from creation until now, a stretch per status it stood
 * in; the stretches it stood done or canceled are left out, so a finished
 * task's bar ends and a reopened one picks up after a gap.
 */
export function ganttSegmentsOf(task: Task, moves: readonly StatusTransition[], nowMs: number): GanttSegment[] {
  const born = createdMs(task);
  const changes = [
    { status: statusBefore(task, moves, born), atMs: born },
    ...moves.flatMap((move) => (move.atMs >= born && move.atMs < nowMs && isStatus(move.toStatus) ? [{ status: move.toStatus, atMs: move.atMs }] : [])),
  ];
  return changes
    .map((change, index) => ({ status: change.status, fromMs: change.atMs, toMs: changes[index + 1]?.atMs ?? nowMs }))
    .filter((segment) => !FINISHED.has(segment.status) && segment.fromMs < segment.toMs);
}

export interface GanttInput {
  tasks: readonly Task[];
  /** Each task's moves, oldest first (`movesByTask`). */
  moves: ReadonlyMap<string, readonly StatusTransition[]>;
  /** Projects to keep; empty keeps every project. */
  projectIds: readonly string[];
  /** Where the Gantt opens: earlier stretches are cut off at it. */
  fromMs: number;
  nowMs: number;
}

const hasPlan = (task: Task) => task.startDate !== null || task.dueDate !== null;

/**
 * The rows of a Gantt opening at `fromMs`: every task that stood open after
 * it, its stretches cut at it, and every task with planned dates — the
 * client places those on its own calendar, and orders the rows by it.
 */
export function ganttRowsOf(input: GanttInput): GanttRow[] {
  return input.tasks
    .filter((task) => inProjects(input.projectIds, task.projectId))
    .map((task) => ({
      task,
      segments: ganttSegmentsOf(task, input.moves.get(task.id) ?? [], input.nowMs)
        .filter((segment) => segment.toMs > input.fromMs)
        .map((segment) => ({ ...segment, fromMs: Math.max(segment.fromMs, input.fromMs) })),
    }))
    .filter((row) => row.segments.length > 0 || hasPlan(row.task));
}
