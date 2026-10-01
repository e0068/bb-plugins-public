// Pure core behind the analytics flow charts: burndown and work in progress
// (status per column), created against closed, status changes, cycle time,
// estimate accuracy, spend by project, closings by type and the tasks that
// stand longest in their status. No I/O, no clock — the RPC handler
// (api/index.ts) hands it the tasks and the transition log, and "now" and
// the column edges come in as values. The edges are the client's local
// calendar, so this only compares numbers.
//
// The transition log starts at install and is not backfilled: before a
// task's first logged move its status is the one that move left, and a task
// never moved has stood in its current status all along.
import { TASK_ESTIMATES, TASK_STATUSES, TASK_TYPES } from "../db/types.js";
import type { TaskEstimate, TaskStatus, TaskType } from "../db/types.js";
import type { StatusTransition } from "../db/transition-log.js";
import { roundToCents } from "../shared/amounts.js";
import type { Task } from "../shared/contract.js";
import { UNTYPED_KEY } from "./aggregate.js";
import { binOf, closedInBins, strictlyIncreasing, type ClosedEntry } from "./closed.js";

/** How many stuck tasks the aging list keeps. */
export const AGING_LIMIT = 15;

/** Statuses a task can stand in while someone still owes work on it — the aging list's scope. */
const AGING_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "in_review"];

export interface FlowInput {
  tasks: readonly Task[];
  transitions: readonly StatusTransition[];
  /** Series columns: column `i` is `[edges[i], edges[i + 1])`. The window of cycle, accuracy and spend is `[edges[0], edges[last])`. */
  edges: readonly number[];
  /** Week columns of the closings-by-type chart, same convention. */
  weekEdges: readonly number[];
  /** Projects to keep; empty keeps every project. */
  projectIds: readonly string[];
  /** A column that has not ended yet is read at this moment. */
  nowMs: number;
}

export type StatusCounts = Record<TaskStatus, number>;
export type TypeCounts = Record<TaskType | typeof UNTYPED_KEY, number>;

/** Spread of a duration over a set of tasks. */
export interface CycleRow {
  estimate: TaskEstimate;
  count: number;
  medianMs: number;
  p90Ms: number;
}

/** Plan against fact over the tasks carrying both: medians, and the median of fact ÷ plan per task. */
export interface PlanFact {
  count: number;
  planned: number;
  actual: number;
  ratio: number;
}

/** An estimate's accuracy; a side is absent when no closed task carried both its plan and fact. */
export interface AccuracyRow {
  estimate: TaskEstimate;
  minutes?: PlanFact;
  money?: PlanFact;
}

export interface AgingEntry {
  taskId: string;
  projectId: string;
  status: TaskStatus;
  sinceMs: number;
}

export interface Flow {
  /** Per project, per column: how many tasks stood in each status when the column ended. */
  statusByBin: Record<string, StatusCounts[]>;
  created: number[];
  closed: number[];
  /** Per column: moves into each status. */
  changes: StatusCounts[];
  cycle: CycleRow[];
  /** Median cycle over every measured task, estimated or not; null when none was measured. */
  medianCycleMs: number | null;
  accuracy: AccuracyRow[];
  costByProject: { projectId: string; cost: number }[];
  typesByWeek: TypeCounts[];
  aging: AgingEntry[];
}

const zeroed = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

const isStatus = (value: string | null): value is TaskStatus => TASK_STATUSES.includes(value as TaskStatus);

/** Column ends, each read no later than now. Fewer than two edges give no columns. */
const columnEnds = (edges: readonly number[], nowMs: number) => edges.slice(1).map((end) => Math.min(end, nowMs));

/** Index of the column holding `atMs`, or -1 outside every column. */
const columnOf = (edges: readonly number[], atMs: number) =>
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
const median = (sorted: readonly number[]) => {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Nearest-rank 90th percentile of an ascending non-empty list. */
const p90 = (sorted: readonly number[]) => sorted[Math.ceil(sorted.length * 0.9) - 1]!;

const ascending = (values: readonly number[]) => [...values].sort((a, b) => a - b);

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

function statusByBin(tasks: readonly Task[], moves: Map<string, StatusTransition[]>, ends: readonly number[]) {
  const byProject = new Map<string, StatusCounts[]>();
  for (const task of tasks) {
    const born = createdMs(task);
    const rows = byProject.get(task.projectId) ?? ends.map(() => zeroed(TASK_STATUSES));
    byProject.set(
      task.projectId,
      rows.map((counts, bin) => {
        if (born >= ends[bin]!) return counts;
        const status = statusBefore(task, moves.get(task.id) ?? [], ends[bin]!);
        return { ...counts, [status]: counts[status] + 1 };
      }),
    );
  }
  return Object.fromEntries(byProject);
}

function countsPerColumn(times: readonly number[], edges: readonly number[]): number[] {
  const counts = Array.from({ length: Math.max(0, edges.length - 1) }, () => 0);
  return times.reduce((acc, atMs) => {
    const bin = edges.length < 2 ? -1 : columnOf(edges, atMs);
    return bin < 0 ? acc : acc.map((count, index) => (index === bin ? count + 1 : count));
  }, counts);
}

function changesPerColumn(transitions: readonly StatusTransition[], edges: readonly number[]): StatusCounts[] {
  const columns = Array.from({ length: Math.max(0, edges.length - 1) }, () => zeroed(TASK_STATUSES));
  return transitions.reduce((acc, move) => {
    const bin = edges.length < 2 || !isStatus(move.toStatus) ? -1 : columnOf(edges, move.atMs);
    if (bin < 0) return acc;
    const status = move.toStatus as TaskStatus;
    return acc.map((counts, index) => (index === bin ? { ...counts, [status]: counts[status] + 1 } : counts));
  }, columns);
}

/** Time from the first move into in progress to the closing; absent when the task was never seen in progress before it. */
function cycleMs(closing: ClosedEntry, moves: readonly StatusTransition[]): number | undefined {
  const start = moves.find((move) => move.toStatus === "in_progress" && move.atMs <= closing.atMs);
  return start === undefined ? undefined : closing.atMs - start.atMs;
}

function planFact(pairs: readonly (readonly [number | null, number | null])[]): PlanFact | undefined {
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

function agingOf(tasks: readonly Task[], moves: Map<string, StatusTransition[]>): AgingEntry[] {
  return tasks
    .filter((task) => AGING_STATUSES.includes(task.status))
    .map((task) => {
      const into = (moves.get(task.id) ?? []).filter((move) => move.toStatus === task.status);
      const since = into[into.length - 1]?.atMs ?? createdMs(task);
      return { taskId: task.id, projectId: task.projectId, status: task.status, sinceMs: since };
    })
    .sort((a, b) => a.sinceMs - b.sinceMs)
    .slice(0, AGING_LIMIT);
}

export function flowOf(input: FlowInput): Flow {
  const tasks = input.tasks.filter((task) => inProjects(input.projectIds, task.projectId));
  const transitions = input.transitions.filter((move) => inProjects(input.projectIds, move.projectId));
  const moves = movesByTask(transitions);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  // Edges that do not rise make no columns — for every chart alike, not just the closings.
  const edges = strictlyIncreasing(input.edges) ? input.edges : [];

  const closings = edges.length < 2 ? [] : closedInBins(transitions, edges);
  const closedTasks = closings.flatMap((closing) => {
    const task = tasksById.get(closing.taskId);
    return task === undefined ? [] : [{ closing, task }];
  });

  const measured = closedTasks.flatMap(({ closing, task }) => {
    const ms = cycleMs(closing, moves.get(task.id) ?? []);
    return ms === undefined ? [] : [{ estimate: task.estimate, ms }];
  });
  const cycle = TASK_ESTIMATES.flatMap((estimate) => {
    const spans = ascending(measured.filter((entry) => entry.estimate === estimate).map((entry) => entry.ms));
    return spans.length === 0 ? [] : [{ estimate, count: spans.length, medianMs: median(spans), p90Ms: p90(spans) }];
  });
  const allSpans = ascending(measured.map((entry) => entry.ms));

  const accuracy = TASK_ESTIMATES.flatMap((estimate): AccuracyRow[] => {
    const own = closedTasks.map(({ task }) => task).filter((task) => task.estimate === estimate);
    const minutes = planFact(own.map((task) => [task.plannedMinutes, task.actualMinutes] as const));
    const money = planFact(own.map((task) => [task.budget, task.cost] as const));
    if (minutes === undefined && money === undefined) return [];
    return [{ estimate, ...(minutes && { minutes }), ...(money && { money }) }];
  });

  const spend = closedTasks.reduce(
    (acc, { task }) => (task.cost ? acc.set(task.projectId, (acc.get(task.projectId) ?? 0) + task.cost) : acc),
    new Map<string, number>(),
  );

  const weekClosings = input.weekEdges.length < 2 ? [] : closedInBins(transitions, input.weekEdges);
  const typesByWeek = Array.from({ length: Math.max(0, input.weekEdges.length - 1) }, (_, week) =>
    weekClosings
      .filter((closing) => closing.bin === week)
      .reduce((counts, closing) => {
        const type = tasksById.get(closing.taskId)?.type ?? UNTYPED_KEY;
        return { ...counts, [type]: counts[type] + 1 };
      }, zeroed([...TASK_TYPES, UNTYPED_KEY])),
  );

  return {
    statusByBin: statusByBin(tasks, moves, columnEnds(edges, input.nowMs)),
    created: countsPerColumn(tasks.map(createdMs), edges),
    closed: countsPerColumn(closings.map((closing) => closing.atMs), edges),
    changes: changesPerColumn(transitions, edges),
    cycle,
    medianCycleMs: allSpans.length === 0 ? null : median(allSpans),
    accuracy,
    costByProject: [...spend]
      .map(([projectId, cost]) => ({ projectId, cost: roundToCents(cost) }))
      .sort((a, b) => b.cost - a.cost),
    typesByWeek,
    aging: agingOf(tasks, moves),
  };
}
