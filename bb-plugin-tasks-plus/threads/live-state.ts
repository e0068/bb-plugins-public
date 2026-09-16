import type { TaskThread, TaskThreadLiveStatus } from "../db/types.js";

/**
 * The durable half of a task↔thread link: the fact that somebody attached
 * this thread to this task. Written to the task file once, at attach, and
 * never touched again by the plugin's own bookkeeping.
 */
export interface AttachedThread {
  id: string;
  taskId: string;
  threadId: string;
  presetName: string;
  title: string;
  attachedAt: string;
}

/**
 * The volatile half: where the bb thread is right now. Never written to the
 * file — a `working → idle` flip is not a repository edit (see
 * memory/decisions/tasks-plus-thread-state-is-not-a-file-field.md).
 */
export interface ThreadLiveState {
  liveStatus: TaskThreadLiveStatus;
  archivedAt: string | null;
}

/** What a bb thread looks like from here: the three fields the state is read
 *  from, so this module needs neither the SDK nor a live host to be tested. */
export interface ObservedThread {
  status: "starting" | "active" | "stopping" | "idle" | "error";
  archivedAt: number | null;
  deletedAt: number | null;
}

/** A thread attached but not yet observed — the plugin restarted and
 *  reconciliation has not reached it. Same reading the file used to default
 *  to, so the board looks the same in that window. */
export const UNKNOWN_THREAD_LIVE_STATE: ThreadLiveState = {
  liveStatus: "idle",
  archivedAt: null,
};

function observedLiveStatus(thread: ObservedThread): TaskThreadLiveStatus {
  if (thread.deletedAt !== null) return "completed";
  switch (thread.status) {
    case "starting":
      return "starting";
    case "active":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
    case "error":
      return "failed";
  }
}

/**
 * The one reading of a bb thread's state. `archivedAt` stays beside
 * `liveStatus` rather than collapsing into it: a thread can be
 * idle-and-archived (Waiting excludes it) or working-and-archived — see
 * memory/decisions/tasks-plus-thread-archived-separate-column.md.
 */
export function threadLiveState(thread: ObservedThread): ThreadLiveState {
  return {
    liveStatus: observedLiveStatus(thread),
    archivedAt:
      thread.archivedAt === null ? null : new Date(thread.archivedAt).toISOString(),
  };
}

/** The state after an event that only speaks about one half of it: a
 *  `thread.idle` event says nothing about archival and must not erase it. */
export function patchLiveState(
  previous: ThreadLiveState | undefined,
  patch: Partial<ThreadLiveState>,
): ThreadLiveState {
  return { ...UNKNOWN_THREAD_LIVE_STATE, ...previous, ...patch };
}

/** A never-observed thread is not equal to anything: the first observation
 *  is always news, even when it reads exactly like the default. */
export function sameLiveState(
  previous: ThreadLiveState | undefined,
  next: ThreadLiveState,
): boolean {
  return (
    previous !== undefined &&
    previous.liveStatus === next.liveStatus &&
    previous.archivedAt === next.archivedAt
  );
}

export function withLiveState(
  thread: AttachedThread,
  state: ThreadLiveState = UNKNOWN_THREAD_LIVE_STATE,
): TaskThread {
  return { ...thread, ...state };
}

/** What goes into the file's `threads:` block. `taskId` is left out on
 *  purpose: the task is the file the block sits in. */
export function serializeAttachedThread(
  thread: AttachedThread,
): Record<string, unknown> {
  return {
    id: thread.id,
    threadId: thread.threadId,
    presetName: thread.presetName,
    title: thread.title,
    attachedAt: thread.attachedAt,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads the `threads:` block of one task file. Only the attachment fact is
 * taken — `liveStatus`/`archivedAt`/`updatedAt` written by an older version
 * are ignored here and disappear from the file the next time the block is
 * rewritten.
 */
export function parseAttachedThreads(
  taskId: string,
  frontmatter: Record<string, unknown>,
): AttachedThread[] {
  const raw = frontmatter.threads;
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((e) => typeof e.id === "string" && typeof e.threadId === "string")
    .map((e) => ({
      id: e.id as string,
      taskId,
      threadId: e.threadId as string,
      presetName: text(e.presetName),
      title: text(e.title),
      attachedAt: text(e.attachedAt),
    }));
}
