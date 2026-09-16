import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import type { TaskThread } from "../db";
import {
  createSystemComment,
  publishCommentsChanged,
  publishThreadsChanged,
} from "../delegate";
import {
  patchLiveState,
  sameLiveState,
  threadLiveState,
  type ThreadLiveState,
} from "../threads/live-state.js";
import {
  needsTerminalComment,
  terminalCommentBody,
  type TerminalLiveStatus,
} from "../threads/terminal-comment.js";

// Only "completed" is a true dead-end. "failed" stays reconcilable: a thread
// that ended in error and is later archived must still reach "completed"
// (otherwise a finished, merged task keeps reading as "Failed" forever).
const TERMINAL_LIVE_STATUSES = new Set<TaskThread["liveStatus"]>(["completed"]);
export const THREAD_STATUS_RECONCILE_INTERVAL_MS = 5 * 60_000;
export const THREAD_STATUS_IDLE_INTERVAL_MS = 60_000;

type SdkThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

function isTerminal(liveStatus: TaskThread["liveStatus"]): boolean {
  return TERMINAL_LIVE_STATUSES.has(liveStatus);
}

function terminalOf(state: ThreadLiveState): TerminalLiveStatus | null {
  return state.liveStatus === "completed" || state.liveStatus === "failed"
    ? state.liveStatus
    : null;
}

async function trackedThreads(store: TasksApiStore, threadId?: string): Promise<TaskThread[]> {
  const tracked: TaskThread[] = [];
  for (const task of await store.tasks.listTasks()) {
    for (const thread of await store.tasks.listTaskThreads(task.id)) {
      if (threadId === undefined || thread.threadId === threadId) {
        tracked.push(thread);
      }
    }
  }
  return tracked;
}

function sdkErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

/** Reports on the task that the thread it delegated to has ended. Written
 *  once: the task's own comments are the record, because the live status
 *  that used to guard this is process memory now. */
async function reportTerminalState(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: TaskThread,
  liveStatus: TerminalLiveStatus,
): Promise<void> {
  const body = terminalCommentBody(thread, liveStatus);
  if (!needsTerminalComment(await store.tasks.listComments(thread.taskId), body)) {
    return;
  }
  await createSystemComment(store.tasks, {
    taskId: thread.taskId,
    presetName: thread.presetName,
    threadId: thread.threadId,
    body,
  });
  publishCommentsChanged(bb, thread.taskId);
}

/**
 * Records where a bb thread got to. Nothing is written to the task file:
 * the file holds the fact that the thread is attached, this holds what the
 * thread is doing (see
 * memory/decisions/tasks-plus-thread-state-is-not-a-file-field.md).
 */
async function observeThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  threadId: string,
  patch: Partial<ThreadLiveState>,
): Promise<void> {
  const previous = store.tasks.getThreadLiveState(threadId);
  if (previous && isTerminal(previous.liveStatus)) return;

  const next = patchLiveState(previous, patch);
  if (sameLiveState(previous, next)) return;
  store.tasks.setThreadLiveState(threadId, next);

  const terminal = terminalOf(next);
  for (const thread of await trackedThreads(store, threadId)) {
    if (terminal) await reportTerminalState(bb, store, thread, terminal);
    publishThreadsChanged(bb, thread.taskId);
  }
}

async function reconcileThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  threadId: string,
): Promise<void> {
  try {
    await observeThread(
      bb,
      store,
      threadId,
      threadLiveState(await bb.sdk.threads.get({ threadId })),
    );
  } catch (error) {
    if (sdkErrorCode(error) === "thread_not_found") {
      await observeThread(bb, store, threadId, { liveStatus: "completed" });
      return;
    }
    bb.log.warn(
      `Could not reconcile task thread ${threadId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** The bb threads attached to some task and not known to be over — the set
 *  reconciliation asks bb about. One entry per thread, however many tasks
 *  it is attached to. */
async function reconcilableThreadIds(store: TasksApiStore): Promise<string[]> {
  const ids = new Set<string>();
  for (const thread of await trackedThreads(store)) {
    if (!isTerminal(thread.liveStatus)) ids.add(thread.threadId);
  }
  return [...ids];
}

async function reconcileTrackedThreads(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  for (const threadId of await reconcilableThreadIds(store)) {
    await reconcileThread(bb, store, threadId);
  }
}

function waitForNextReconciliation(
  signal: AbortSignal,
  intervalMs: number,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function archivedAtOf(thread: SdkThread): string | null {
  return threadLiveState(thread).archivedAt;
}

export async function registerLifecycle(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  bb.events.on("thread.created", ({ thread }) => {
    void observeThread(bb, store, thread.id, threadLiveState(thread));
  });
  bb.events.on("thread.active", ({ thread }) => {
    void observeThread(bb, store, thread.id, { liveStatus: "working" });
  });
  bb.events.on("thread.idle", ({ thread }) => {
    void observeThread(bb, store, thread.id, { liveStatus: "idle" });
  });
  bb.events.on("thread.failed", ({ thread }) => {
    void observeThread(bb, store, thread.id, { liveStatus: "failed" });
  });
  bb.events.on("thread.archived", ({ thread }) => {
    void observeThread(bb, store, thread.id, { archivedAt: archivedAtOf(thread) });
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    void observeThread(bb, store, thread.id, { liveStatus: "completed" });
  });

  // Lifecycle events cover live transitions without a full-SDK subscription.
  // Reconciliation is the recovery path for transitions that happened while
  // the plugin was unloaded — and, since live state is process memory, the
  // only source of it after a restart.
  bb.background.service("thread-status-reconcile", {
    async start(signal) {
      while (!signal.aborted) {
        if ((await reconcilableThreadIds(store)).length === 0) {
          await waitForNextReconciliation(
            signal,
            THREAD_STATUS_IDLE_INTERVAL_MS,
          );
          continue;
        }
        await waitForNextReconciliation(
          signal,
          THREAD_STATUS_RECONCILE_INTERVAL_MS,
        );
        if (signal.aborted) break;
        await reconcileTrackedThreads(bb, store);
      }
    },
  });

  await reconcileTrackedThreads(bb, store);
}
