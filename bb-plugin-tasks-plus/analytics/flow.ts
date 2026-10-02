// Pure helpers of the analytics core over tasks and the transition log:
// which column a moment falls in, where a task stood at a moment, since when
// it stands in its status, how long its cycle took, and medians of plan
// against fact. No I/O, no clock — callers (tile.ts, gantt.ts, burndown.ts)
// hand in the tasks, the moves, "now" and the column edges as values. The
// edges are the client's local calendar, so this only compares numbers.
//
// The transition log starts at install and is not backfilled: before a
// task's first logged move its status is the one that move left, and a task
// never moved has stood in its current status all along.
import { TASK_STATUSES } from "../db/types.js";
import type { TaskStatus } from "../db/types.js";
import type { StatusTransition } from "../db/transition-log.js";
import type { Task } from "../shared/contract.js";
import { binOf, type ClosedEntry } from "./closed.js";

/** Plan against fact over the tasks carrying both: medians, and the median of fact ÷ plan per task. */
export interface PlanFact {
  count: number;
  planned: number;
  actual: number;
  ratio: number;
}

const isStatus = (value: string | null): value is TaskStatus => TASK_STATUSES.includes(value as TaskStatus);

/** Column ends, each read no later than now. Fewer than two edges give no columns. */
export const columnEnds = (edges: readonly number[], nowMs: number) => edges.slice(1).map((end) => Math.min(end, nowMs));

/** Index of the column holding `atMs`, or -1 outside every column. */
export const columnOf = (edges: readonly number[], atMs: number) =>
  atMs < edges[0]! || atMs >= edges[edges.length - 1]! ? -1 : binOf(edges, atMs);

/** Whether an analytics call narrowed to `projectIds` keeps `projectId`; absent or empty keeps every project. */
export const inProjects = (projectIds: readonly string[] | undefined, projectId: string): boolean =>
  projectIds === undefined || projectIds.length === 0 || projectIds.includes(projectId);

/** A task's creation time; an unreadable date puts it before any column. */
export const createdMs = (task: Task) => {
  const parsed = Date.parse(task.createdAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

/** Middle of an ascending non-empty list; the mean of the two middles when even. */
export const median = (sorted: readonly number[]) => {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Nearest-rank 90th percentile of an ascending non-empty list. */
export const p90 = (sorted: readonly number[]) => sorted[Math.ceil(sorted.length * 0.9) - 1]!;

export const ascending = (values: readonly number[]) => [...values].sort((a, b) => a - b);

/** The moves of each task, oldest first — a stable sort keeps the log's own order on ties. */
export function movesByTask(transitions: readonly StatusTransition[]): Map<string, StatusTransition[]> {
  const byTask = new Map<string, StatusTransition[]>();
  for (const move of [...transitions].sort((a, b) => a.atMs - b.atMs)) {
    byTask.set(move.taskId, [...(byTask.get(move.taskId) ?? []), move]);
  }
  return byTask;
}

/** Where a task stood just before `atMs`: its last earlier move, else what its first move left, else where it stands now. */
export function statusBefore(task: Task, moves: readonly StatusTransition[], atMs: number): TaskStatus {
  const earlier = moves.filter((move) => move.atMs < atMs);
  const last = earlier[earlier.length - 1];
  if (last !== undefined) return isStatus(last.toStatus) ? last.toStatus : task.status;
  const first = moves[0];
  return first !== undefined && isStatus(first.fromStatus) ? first.fromStatus : task.status;
}

/** Time from the first move into in progress to the closing; absent when the task was never seen in progress before it. */
export function cycleMs(closing: ClosedEntry, moves: readonly StatusTransition[]): number | undefined {
  const start = moves.find((move) => move.toStatus === "in_progress" && move.atMs <= closing.atMs);
  return start === undefined ? undefined : closing.atMs - start.atMs;
}

/** Plan against fact over the pairs carrying both; none when no pair does. */
export function planFact(pairs: readonly (readonly [number | null, number | null])[]): PlanFact | undefined {
  const both = pairs.filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);
  if (both.length === 0) return undefined;
  const ratios = both.filter(([plan]) => plan > 0).map(([plan, fact]) => fact / plan);
  return {
    count: both.length,
    planned: median(ascending(both.map(([plan]) => plan))),
    actual: median(ascending(both.map(([, fact]) => fact))),
    ratio: ratios.length === 0 ? 0 : median(ascending(ratios)),
  };
}

/** Since when a task stands in its status: its last move into it, else its creation. */
export function sinceOf(task: Task, moves: readonly StatusTransition[]): number {
  const into = moves.filter((move) => move.toStatus === task.status);
  return into[into.length - 1]?.atMs ?? createdMs(task);
}

