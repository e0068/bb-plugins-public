// The rule of taking a task: one for the board, the CLI and a thread.
// A task in progress or in review that another machine holds cannot be
// taken; taking a free one stamps this machine, going back to backlog/todo
// takes the stamp off, done and canceled keep it as history.
//
// A pure module: no zod, no values from contract.js — it is pulled into the
// frontend bundle, which may import only types from the RPC contract.

import type { TaskStatus } from "./enums.js";

/** Who took a task, from where, and when (`at` is ISO 8601 in UTC). */
export type TakenBy = { machine: string; threadId: string | null; at: string };

/** The part of a task the rule looks at. */
export interface ClaimState {
  status: TaskStatus;
  takenBy?: TakenBy | null;
}

/** The task is free to take, already held by this machine, or held by another. */
export type ClaimDecision = "free" | "mine" | { taken: TakenBy };

const HELD_STATUSES: readonly TaskStatus[] = ["in_progress", "in_review"];
const RESET_STATUSES: readonly TaskStatus[] = ["backlog", "todo"];
const HISTORY_STATUSES: readonly TaskStatus[] = ["done", "canceled"];

/** Can `me` take the task: refused only while the task is in progress or in
 *  review and another machine holds it. */
export function claimDecision(current: ClaimState, me: string): ClaimDecision {
  const held = current.takenBy ?? null;
  if (held === null) return "free";
  if (held.machine === me) return "mine";
  return HELD_STATUSES.includes(current.status) ? { taken: held } : "free";
}

/**
 * The mark a write leaves on the task. Going back to backlog/todo clears it;
 * done and canceled keep it; a write that takes the task (In Progress or a
 * thread attached) stamps this machine — unless this machine already holds
 * it (the first mark stays) or another machine does (its mark is never
 * rewritten).
 */
export function nextTakenBy(
  before: ClaimState,
  after: { status: TaskStatus; threadAttached: boolean },
  me: string,
  threadId: string | null,
  now: Date,
): TakenBy | null {
  const held = before.takenBy ?? null;
  if (RESET_STATUSES.includes(after.status)) return null;
  const takes = (after.status === "in_progress" || after.threadAttached) && !HISTORY_STATUSES.includes(after.status);
  if (!takes) return held;
  const decision = claimDecision(before, me);
  if (decision === "mine") return held;
  if (decision === "free") return { machine: me, threadId, at: now.toISOString() };
  return decision.taken;
}

/** What a write asks for: a status (undefined when it is not changed) and
 *  whether it attaches a thread. */
export interface ClaimRequest {
  status: TaskStatus | undefined;
  attachesThread: boolean;
  threadId: string | null;
}

export type ClaimOutcome = { ok: true; takenBy: TakenBy | null } | { ok: false; takenBy: TakenBy };

/**
 * The rule a write of the store follows. A write takes the task when it asks
 * for In Progress or attaches a thread; it is refused only when it takes and
 * `claimDecision` refuses. Otherwise it goes through with the mark it leaves.
 */
export function claimOnWrite(current: ClaimState, request: ClaimRequest, me: string, now: Date): ClaimOutcome {
  const takes = request.status === "in_progress" || request.attachesThread;
  const decision = claimDecision(current, me);
  if (takes && typeof decision === "object") return { ok: false, takenBy: decision.taken };
  if (request.status === undefined && !request.attachesThread) return { ok: true, takenBy: current.takenBy ?? null };
  const takenBy = nextTakenBy(
    current,
    { status: request.status ?? current.status, threadAttached: request.attachesThread },
    me,
    request.threadId,
    now,
  );
  return { ok: true, takenBy };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long ago: `N s ago`, `N min ago`, `N h ago`, `N d ago`. A time in the
 *  future or one that does not parse reads as `0 s ago`. */
export function formatTakenAgo(at: string, now: Date): string {
  const elapsed = now.getTime() - new Date(at).getTime();
  const ms = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (ms < MINUTE_MS) return `${Math.floor(ms / 1000)} s ago`;
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} h ago`;
  return `${Math.floor(ms / DAY_MS)} d ago`;
}

/** The refusal line: names the key, the machine, the thread and how long ago. */
export function describeTakenBy(key: string, takenBy: TakenBy, now: Date): string {
  const thread = takenBy.threadId === null ? "" : ` in thread ${takenBy.threadId}`;
  return `${key} is already taken on ${takenBy.machine}${thread}, ${formatTakenAgo(takenBy.at, now)}`;
}
