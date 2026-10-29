import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import type { TaskThread } from "../db";
import { publishThreadsChanged } from "../delegate";
import { unlessOutOfReach } from "../filesync/task-repo.js";
import { hasOwnTree } from "../filesync/branch-threads.js";
import { resolveCallerEnvironment } from "../filesync/resolve-roots.js";
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
  for (const taskId of store.tasks.branchTaskIds(threadId)) {
    publishThreadsChanged(bb, taskId);
  }
  // Архивный или удалённый тред не попадёт ни в Active, ни в Waiting: память
  // о нём в ветке больше не нужна и не копится от перезапуска к перезапуску.
  if (next.archivedAt !== null || isTerminal(next.liveStatus)) {
    store.tasks.forgetBranchThread(threadId);
  }
}

/**
 * Тред, впервые замеченный в своём дереве: его задачи в ветке находятся
 * одним чтением этого дерева (filesync/branch-threads.ts). Каждый тред
 * проверяется раз за жизнь процесса — по окружению из самого события, без
 * обхода живых деревьев (decisions/tasks-plus-board-roots-blocks-rpc.md).
 */
async function noticeBranchThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  checked: Set<string>,
  thread: Pick<SdkThread, "id" | "environmentId">,
): Promise<void> {
  if (checked.has(thread.id) || store.tasks.knowsBranchThread(thread.id)) return;
  checked.add(thread.id);
  const environment = await resolveCallerEnvironment(bb, thread.environmentId ?? null);
  if (!hasOwnTree(environment)) return;
  for (const taskId of await store.tasks.discoverBranchThread(thread.id, environment)) {
    publishThreadsChanged(bb, taskId);
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
  const ids = new Set<string>(store.tasks.branchThreadIds());
  for (const thread of await trackedThreads(store)) {
    if (!isTerminal(thread.liveStatus)) ids.add(thread.threadId);
  }
  return [...ids];
}

/** One pass over the tracked threads, one bb read per thread. Stops between
 *  threads once the signal aborts: after a timeout or unload the API handle is
 *  stale, and every further read would only log a warning. Returns how many
 *  threads there were to reconcile (0 — nothing is tracked). */
async function reconcileTrackedThreads(
  bb: BbPluginApi,
  store: TasksApiStore,
  signal: AbortSignal,
): Promise<number> {
  const threadIds = await reconcilableThreadIds(store);
  for (const threadId of threadIds) {
    if (signal.aborted) break;
    await reconcileThread(bb, store, threadId);
  }
  return threadIds.length;
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
  const checkedForBranch = new Set<string>();
  bb.events.on("thread.created", ({ thread }) => {
    void observeThread(bb, store, thread.id, threadLiveState(thread));
  });
  bb.events.on("thread.active", ({ thread }) => {
    void observeThread(bb, store, thread.id, { liveStatus: "working" });
    void noticeBranchThread(bb, store, checkedForBranch, thread);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    void observeThread(bb, store, thread.id, { liveStatus: "idle" });
    void noticeBranchThread(bb, store, checkedForBranch, thread);
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
  // only source of it after a restart. The first pass runs at once when the
  // service starts, in the background: bb gives the plugin factory 30 s, and
  // one thread read per tracked thread does not fit into that.
  bb.background.service("thread-status-reconcile", {
    async start(signal) {
      while (!signal.aborted) {
        const reconciled = await reconcileTrackedThreads(bb, store, signal);
        await waitForNextReconciliation(
          signal,
          reconciled === 0
            ? THREAD_STATUS_IDLE_INTERVAL_MS
            : THREAD_STATUS_RECONCILE_INTERVAL_MS,
        );
      }
    },
  });

  await store.tasks.restoreBranchThreads();
}
