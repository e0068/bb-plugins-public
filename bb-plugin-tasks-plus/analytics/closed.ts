// Pure core behind the "closed tasks" charts: which task closed in which
// column. The columns come in as edges the client computed in its own zone
// (local hours, local midnights), so this never touches a calendar — it only
// compares numbers. No I/O, no clock; the RPC handler (api/index.ts) hands it
// the transitions it read.
import type { StatusTransition } from "../db/transition-log.js";

/** The status that counts as closing a task. Canceled work is not closed work. */
const CLOSED_STATUS = "done";

/** One closed task and the column it landed in: `edges[bin] <= atMs < edges[bin + 1]`. */
export interface ClosedEntry {
  taskId: string;
  projectId: string;
  atMs: number;
  bin: number;
}

/** Whether column edges form columns at all: strictly increasing. */
export const strictlyIncreasing = (edges: readonly number[]) => edges.every((edge, i) => i === 0 || edge > edges[i - 1]!);

/** Index of the column holding `atMs` inside `[edges[0], edges[last])`: with strictly increasing edges, the edges at or before it, less one. */
export const binOf = (edges: readonly number[], atMs: number) => edges.filter((edge) => edge <= atMs).length - 1;

/**
 * The tasks closed in the window `[edges[0], edges[last])`, each placed in the
 * column of its closing. A task counts once, by its last change inside the
 * window, and only if that change moved it into done: closed, reopened and
 * closed again lands at the second closing; closed then reopened is not
 * closed at all. Ordered by time.
 *
 * Total: fewer than two edges, or edges that do not strictly increase, give no
 * columns and so no closings.
 */
export function closedInBins(transitions: readonly StatusTransition[], edges: readonly number[]): ClosedEntry[] {
  if (edges.length < 2 || !strictlyIncreasing(edges)) return [];
  const fromMs = edges[0]!;
  const toMs = edges[edges.length - 1]!;

  // A Map built from pairs keeps the last value per key, so feeding it the
  // window's changes oldest first (a stable sort keeps the log's own order on
  // ties) leaves each task's latest change.
  const inWindow = transitions.filter((t) => t.atMs >= fromMs && t.atMs < toMs).sort((a, b) => a.atMs - b.atMs);
  const lastChangeByTask = new Map(inWindow.map((t) => [t.taskId, t]));

  return [...lastChangeByTask.values()]
    .filter((t) => t.toStatus === CLOSED_STATUS)
    .sort((a, b) => a.atMs - b.atMs)
    .map((t) => ({ taskId: t.taskId, projectId: t.projectId, atMs: t.atMs, bin: binOf(edges, t.atMs) }));
}
