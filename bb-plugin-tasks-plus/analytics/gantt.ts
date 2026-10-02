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

/** A task on a Gantt, the stretches of it the Gantt shows and when it was done. */
export interface GanttRow {
  task: Task;
  segments: GanttSegment[];
  /** When a done task last went done; null for a task that is not done, or whose closing the log does not hold. */
  doneMs: number | null;
}

/** The statuses a Gantt fills — the work itself; waiting in Backlog or To do is not drawn, and Done is a mark, not a stretch. */
const WORKING: ReadonlySet<TaskStatus> = new Set(["in_progress", "in_review"]);

const isStatus = (value: string | null): value is TaskStatus => TASK_STATUSES.includes(value as TaskStatus);

/**
 * The task's work from creation until now, a stretch per working status it
 * stood in; the stretches it waited in Backlog or To do, or stood done or
 * canceled, are left out, so a bar starts where the work did, ends where it
 * stopped and a reopened task picks up after a gap.
 */
export function ganttSegmentsOf(task: Task, moves: readonly StatusTransition[], nowMs: number): GanttSegment[] {
  const born = createdMs(task);
  const changes = [
    { status: statusBefore(task, moves, born), atMs: born },
    ...moves.flatMap((move) => (move.atMs >= born && move.atMs < nowMs && isStatus(move.toStatus) ? [{ status: move.toStatus, atMs: move.atMs }] : [])),
  ];
  return changes
    .map((change, index) => ({ status: change.status, fromMs: change.atMs, toMs: changes[index + 1]?.atMs ?? nowMs }))
    .filter((segment) => WORKING.has(segment.status) && segment.fromMs < segment.toMs);
}

/** When a done task last went done before now; null for any other task. */
export function doneMsOf(task: Task, moves: readonly StatusTransition[], nowMs: number): number | null {
  if (task.status !== "done") return null;
  return moves.filter((move) => move.toStatus === "done" && move.atMs < nowMs).at(-1)?.atMs ?? null;
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
 * The rows of a Gantt opening at `fromMs`: every task that worked or was
 * done after it, its stretches cut at it, and every task with planned dates
 * — the client places those on its own calendar, and orders the rows by it.
 */
export function ganttRowsOf(input: GanttInput): GanttRow[] {
  return input.tasks
    .filter((task) => inProjects(input.projectIds, task.projectId))
    .map((task) => {
      const moves = input.moves.get(task.id) ?? [];
      return {
        task,
        segments: ganttSegmentsOf(task, moves, input.nowMs)
          .filter((segment) => segment.toMs > input.fromMs)
          .map((segment) => ({ ...segment, fromMs: Math.max(segment.fromMs, input.fromMs) })),
        doneMs: doneMsOf(task, moves, input.nowMs),
      };
    })
    .filter((row) => row.segments.length > 0 || (row.doneMs !== null && row.doneMs >= input.fromMs) || hasPlan(row.task));
}
