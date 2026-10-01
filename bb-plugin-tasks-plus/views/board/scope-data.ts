// Type-only: keeps the frontend bundle clear of contract.ts's runtime
// dependencies (zod, the server SDK).
import type { Label, Task } from "../../shared/contract.js";
import { listAllTasks, type TaskListQuery, type TasksRpc } from "../../client/data.js";
import type { ListPreferenceScope } from "../common/list-preference.js";
import { ALL_TIME, type CardChartPeriod } from "../../shared/enums.js";
import type { GanttRowData } from "../analytics/gantt-chart.js";

/** Every task and label a board's screen needs, whatever project it opens on. */
export interface BoardData {
  /** Every task of the board, sub-tasks included, in the server's order: the project's manual order. */
  tasks: Task[];
  labels: Label[];
  labelsById: Map<string, Label>;
}

/**
 * A scope's single project, read back out of it — the one place that knows
 * the "project:<id>" spelling, shared by board-preference.ts's key and this
 * file's query and project list.
 */
export function scopeProjectId(scope: ListPreferenceScope): string | null {
  return scope.startsWith("project:") ? scope.slice("project:".length) : null;
}

/** The server-side narrowing a screen's board asks for — the same one its list uses. */
export function scopeQuery(scope: ListPreferenceScope): TaskListQuery {
  const projectId = scopeProjectId(scope);
  if (projectId !== null) return { projectId };
  if (scope === "active") return { activeOnly: true };
  if (scope === "waiting") return { waitingOnly: true };
  return {};
}

/** Every project on a cross-project screen's tasks. */
function crossScopeProjectIds(tasks: readonly Task[]): string[] {
  return [...new Set(tasks.map((task) => task.projectId))];
}

/**
 * A project's labels, one project at a time — the contract has no
 * cross-project listLabels — so one project's failure only drops its own
 * labels, never the board.
 */
function labelsOf(rpc: TasksRpc, projectIds: readonly string[]): Promise<Label[]> {
  return Promise.all(
    projectIds.map((projectId) =>
      rpc.call("listLabels", { projectId }).then(
        (result) => result.labels,
        () => [] as Label[],
      ),
    ),
  ).then((lists) => lists.flat());
}

function toBoardData(tasks: Task[], labels: Label[]): BoardData {
  // Every task is a card, a child too: an epic's tasks stay in their columns.
  return { tasks, labels, labelsById: new Map(labels.map((label) => [label.id, label])) };
}

/**
 * What the columns need: the screen's tasks and their labels. Card chips come
 * separately from taskCardMeta (see BoardView), so the columns do not wait on
 * them (BBPL-334). A project's own board knows its labels' project before its
 * tasks land, so the two requests go out together; a cross-project screen
 * only learns which projects it needs from the tasks themselves, so its
 * labels wait on them.
 */
export async function fetchScopeBoard(rpc: TasksRpc, scope: ListPreferenceScope): Promise<BoardData> {
  const projectId = scopeProjectId(scope);
  if (projectId !== null) {
    const [tasks, labels] = await Promise.all([
      listAllTasks(rpc, scopeQuery(scope)),
      labelsOf(rpc, [projectId]),
    ]);
    return toBoardData(tasks, labels);
  }
  const tasks = await listAllTasks(rpc, scopeQuery(scope));
  const labels = await labelsOf(rpc, crossScopeProjectIds(tasks));
  return toBoardData(tasks, labels);
}

/** One card's sub-task burndown, as taskBurndowns serves it. */
export type TaskBurndown = { open: number[]; ends: number[]; forecastDays: number | null };

/**
 * The board's burndowns by task over its period, across every project on
 * screen; a project's failure leaves its own cards without charts, not the
 * rest.
 */
export async function fetchScopeBurndowns(
  rpc: TasksRpc,
  projectIds: readonly string[],
  period: CardChartPeriod,
): Promise<Map<string, TaskBurndown>> {
  const answers = await Promise.all(
    projectIds.map((projectId) =>
      rpc.call("taskBurndowns", { projectId, period }).then(
        (result) => result.burndowns,
        () => [],
      ),
    ),
  );
  return new Map(answers.flat().map(({ taskId, ...burndown }) => [taskId, burndown]));
}

export const DAY_MS = 86_400_000;

/** The board's Gantt rows by task, read at `nowMs`. */
export type BoardGantt = { nowMs: number; rows: ReadonlyMap<string, GanttRowData> };

/** Where the board's Gantt data opens for a period: the period's days back, or the whole history. */
export const ganttFetchStart = (period: CardChartPeriod, nowMs: number) =>
  period === ALL_TIME ? 0 : nowMs - period * DAY_MS;

/**
 * The board's Gantt rows over its period, across every project on screen; a
 * failure leaves the cards without Gantts. No project — a cross-project
 * screen with no tasks yet — asks no RPC either: the server reads an empty
 * `projectIds` as "every project", which would fetch the whole workspace.
 */
export function fetchScopeGantt(
  rpc: TasksRpc,
  projectIds: readonly string[],
  period: CardChartPeriod,
): Promise<BoardGantt | undefined> {
  if (projectIds.length === 0) return Promise.resolve(undefined);
  const nowMs = Date.now();
  return rpc
    .call("ganttRows", { fromMs: ganttFetchStart(period, nowMs), projectIds: [...projectIds] })
    .then(
      (result) => ({ nowMs, rows: new Map(result.rows.map((row) => [row.taskId, row])) }),
      () => undefined,
    );
}
