import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import type { TaskThread } from "../db";
import { publishThreadsChanged } from "../delegate";
import { unlessOutOfReach } from "../filesync/task-repo.js";
import {
  patchLiveState,
  sameLiveState,
  threadLiveState,
  type ThreadLiveState,
} from "../threads/live-state.js";
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

/** Привязанные треды всех досок — по одному чтению каталога на доску.
 *  Поштучный `listTaskThreads` перечитывал бы каталог по разу на задачу, а
 *  этот обход идёт на каждое наблюдение за тредом и раз в тик сверки.
 *  Доска, чья база сейчас недоступна, выпадает из обхода: обход ждёт старт
 *  плагина, и одна такая доска иначе не дала бы запуститься остальным. */
async function trackedThreads(store: TasksApiStore, threadId?: string): Promise<TaskThread[]> {
  const boards = store.tasks.listProjects();
  const perBoard = await Promise.all(
    boards.map((board) => unlessOutOfReach(store.tasks.threadsByTaskId(board.id), new Map<string, TaskThread[]>())),
  );
  return perBoard
    .flatMap((byTask) => [...byTask.values()].flat())
    .filter((thread) => threadId === undefined || thread.threadId === threadId);
}

function sdkErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * Records where a bb thread got to. Ничего не пишется на диск вовсе: файл
 * держит факт привязки, а это — наблюдение за миром (см.
 * docs/decisions/tasks-plus-thread-state-is-not-a-file-field.md и
 * docs/decisions/tasks-plus-no-terminal-report-in-file.md). Запись отсюда
 * шла бы без вызывающего треда, то есть в главный чекаут.
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

  for (const thread of await trackedThreads(store, threadId)) {
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
