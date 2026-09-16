import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import {
  loadFileTasksStore,
  type FileTasksStore,
} from "../filesync/store.js";
import { currentCallerEnvironment } from "../filesync/caller-scope.js";
import type { CallerEnvironmentCache } from "../filesync/caller-cache.js";
import { withCallerScope } from "./caller-scope.js";
import { nextTaskNumber, type BoardConfig } from "../filesync/board-config.js";
import type {
  Attachment as StoredAttachment,
  Comment as StoredComment,
} from "../db/types.js";
import { createTransitionLog, type TransitionLog } from "../db/transition-log.js";
import { seriesFromTransitions, snapshotOf } from "../analytics/aggregate.js";
import {
  AttachmentReferencedError,
  deleteAttachmentById,
  removeAttachmentBlobs,
} from "../attachments";
import { deliverCommentToLatestAgent } from "../steer";
import { isSideChatShapedThread } from "../shared/side-chat";
import {
  resolveSourceAbsPath,
  revealInFinderHere,
} from "../packages/reveal-in-finder";
import {
  tasksRpcContract,
  type Attachment as AttachmentMetadata,
  type Project,
  type ProjectsChangedEvent,
  type SidebarProjectSummary,
  type Task,
  type TaskPullRequest,
  type TasksChangedEvent,
  type TasksDomainError,
  type TaskStatus,
  type CommentsChangedEvent,
  type CommentProvider,
} from "../shared/contract";

type StoredTask = Task;

const PRESET_REASONING_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const MAX_THREAD_SEARCH_RESULTS = 10;

export interface TasksApiStore {
  readonly tasks: FileTasksStore;
  /** Append-only status-transition journal on the plugin's sqlite db (BBPL-260). */
  readonly transitions: TransitionLog;
  transaction<T>(operation: () => T | Promise<T>): Promise<T>;
  projectTaskCount(projectId: string): Promise<number>;
  projectPrefixExists(prefix: string, excludingProjectId: string): boolean;
  openTaskCount(): Promise<number>;
  sidebarSummary(): Promise<SidebarProjectSummary[]>;
}

/**
 * Loads the file-backed store (boards/folders/presets/saved views from kv,
 * tasks read fresh from disk on every call — see decisions/tasks-files-are-
 * the-store.md) and wraps it with the handful of cross-cutting queries the
 * SQL store used to answer with raw SQL. Every field these compute (labels,
 * counts, sidebar summary) is already on the `Task`/`Project` records the
 * store returns, so no separate query layer is needed.
 */
export async function createStore(bb: BbPluginApi): Promise<TasksApiStore> {
  const tasks = await loadFileTasksStore(
    bb.storage.kv,
    (error) =>
      bb.log.warn(`tasks-plus: failed to persist store state: ${String(error)}`),
    currentCallerEnvironment,
  );

  const transitions = createTransitionLog(bb.storage.database());

  return {
    tasks,
    transitions,
    transaction<T>(operation: () => T | Promise<T>): Promise<T> {
      return tasks.transaction(operation);
    },
    async projectTaskCount(projectId: string): Promise<number> {
      return (await tasks.listTasks({ projectId })).length;
    },
    projectPrefixExists(prefix: string, excludingProjectId: string): boolean {
      return tasks
        .listProjects()
        .some(
          (project) =>
            project.id !== excludingProjectId &&
            project.prefix.toLowerCase() === prefix.toLowerCase(),
        );
    },
    async openTaskCount(): Promise<number> {
      return (await tasks.listTasks({}))
        .filter((task) => task.status !== "done" && task.status !== "canceled")
        .length;
    },
    async sidebarSummary(): Promise<SidebarProjectSummary[]> {
      return Promise.all(
        [...tasks.listProjects()]
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .map(async (project) => {
            // One board read for all of the project's tasks and threads —
            // listTaskThreads per task would re-read the whole board once per
            // task (see decisions/tasks-plus-board-roots-blocks-rpc.md).
            const [topLevel, threadsByTask] = await Promise.all([
              tasks.listTasks({ projectId: project.id, parentTaskId: null }),
              tasks.threadsByTaskId(project.id),
            ]);
            const activeThreadIds = new Set<string>();
            for (const task of topLevel) {
              for (const thread of threadsByTask.get(task.id) ?? []) {
                if (thread.liveStatus === "starting" || thread.liveStatus === "working") {
                  activeThreadIds.add(thread.threadId);
                }
              }
            }
            return {
              projectId: project.id,
              taskCount: topLevel.length,
              activeAgentCount: activeThreadIds.size,
            };
          }),
      );
    },
  };
}

class TasksDomainFailure extends Error {
  constructor(readonly detail: TasksDomainError) {
    super(detail.message);
    this.name = "TasksDomainFailure";
  }
}

function fail(code: TasksDomainError["code"], message: string): never {
  throw new TasksDomainFailure({ code, message });
}

function taskFailure(error: TasksDomainFailure) {
  return { ok: false as const, error: error.detail };
}

function projectFailure(error: TasksDomainFailure) {
  return { ok: false as const, error: error.detail };
}

function statusName(status: TaskStatus): string {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function priorityName(priority: StoredTask["priority"]): string {
  return priority[0]?.toUpperCase() + priority.slice(1);
}

function publishTasksChanged(
  bb: BbPluginApi,
  taskId: string,
  projectId: string,
): void {
  const payload: TasksChangedEvent = { taskId, projectId };
  bb.realtime.publish("tasks:changed", payload);
}

/** File sync changed an unknown subset of the project's tasks. */
export function publishProjectTasksChanged(
  bb: BbPluginApi,
  projectId: string,
): void {
  const payload: TasksChangedEvent = { taskId: null, projectId };
  bb.realtime.publish("tasks:changed", payload);
}

export function publishProjectsChanged(
  bb: BbPluginApi,
  projectId: string | null,
): void {
  const payload: ProjectsChangedEvent = { projectId };
  bb.realtime.publish("projects:changed", payload);
}

export function publishCommentsChanged(
  bb: BbPluginApi,
  taskId: string,
  notifiedCount?: number,
): void {
  const payload: CommentsChangedEvent = {
    taskId,
    ...(notifiedCount === undefined ? {} : { notifiedCount }),
  };
  bb.realtime.publish("comments:changed", payload);
}

/**
 * Saved views live in the plugin's shared database, so one tab creating,
 * overwriting, or deleting a view must not go unnoticed by another tab on the
 * same bb — the payload is empty because subscribers just re-list.
 */
function publishViewsChanged(bb: BbPluginApi): void {
  bb.realtime.publish("views:changed", {});
}

/**
 * The file path backing a task, sourced only from a real `file_tasks` link
 * (kept current by `bb tasks sync`). Tasks that still carry a legacy
 * "Source: …" description marker left by the old SQL store but no
 * file_tasks row were never migrated by a sync adoption pass — surface no
 * source for them rather than a stale, possibly-ENOENT path parsed from
 * free text. The parser itself is retained only for that adoption pass in
 * the board's own files, not for this runtime lookup.
 */
/** The file the task lives in is already on the record itself (see
 *  filesync/assemble.ts) — there is no separate file_tasks link to resolve. */
function resolveTaskSourcePath(task: StoredTask): string | null {
  return task.source?.filePath ?? null;
}

/** `store.tasks.getTask`/`listTasks` already return the full API shape
 *  (labelIds, checks, source) — see filesync/assemble.ts — so these are
 *  identity functions kept only so call sites don't need to change. */
function apiTask(_store: TasksApiStore, task: StoredTask): Task {
  return task;
}

function apiTasks(_store: TasksApiStore, tasks: StoredTask[]): Task[] {
  return tasks;
}

/**
 * `nextTaskNumber` isn't stored on a board (see filesync/board-config.ts —
 * there's nothing to keep in sync when a file is added by hand), but the
 * API contract still exposes it, so it's computed here from the board's
 * current files each time a Project crosses the wire.
 */
async function apiProject(store: TasksApiStore, board: BoardConfig): Promise<Project> {
  const keys = (await store.tasks.listTasks({ projectId: board.id })).map((task) => task.key);
  return { ...board, nextTaskNumber: nextTaskNumber(keys, board.prefix) };
}

async function validateTaskParent(
  store: TasksApiStore,
  projectId: string,
  parentTaskId: string | null,
  ownTaskId?: string,
): Promise<void> {
  if (parentTaskId === null) return;
  if (parentTaskId === ownTaskId) {
    fail("task_parent_invalid", "A task cannot be its own parent");
  }

  const parent = await store.tasks.getTask(parentTaskId);
  if (!parent) throw new Error(`Task not found: ${parentTaskId}`);
  if (parent.projectId !== projectId) {
    fail(
      "subtask_project_mismatch",
      "A sub-task must belong to the same project as its parent",
    );
  }
  if (parent.parentTaskId !== null) {
    fail(
      "subtask_depth_exceeded",
      "Tasks support at most one level of sub-tasks",
    );
  }
  if (ownTaskId && (await store.tasks.listSubtasks(ownTaskId)).length > 0) {
    fail(
      "subtask_depth_exceeded",
      "A task with sub-tasks cannot itself become a sub-task",
    );
  }
}

async function replaceTaskLabels(
  store: TasksApiStore,
  taskId: string,
  labelIds: readonly string[],
): Promise<void> {
  const current = new Set(
    (await store.tasks.listTaskLabels(taskId)).map((link) => link.labelId),
  );
  const next = new Set(labelIds);
  for (const labelId of current) {
    if (!next.has(labelId)) await store.tasks.removeTaskLabel(taskId, labelId);
  }
  for (const labelId of next) {
    if (!current.has(labelId)) await store.tasks.addTaskLabel(taskId, labelId);
  }
}

function labelsChanged(
  before: readonly string[],
  after: readonly string[],
): boolean {
  if (before.length !== after.length) return true;
  const afterSet = new Set(after);
  return before.some((labelId) => !afterSet.has(labelId));
}

async function labelChangeBody(
  store: TasksApiStore,
  taskId: string,
  authorName: string,
): Promise<string> {
  const names = (await store.tasks.listLabelsForTask(taskId))
    .map((label) => label.name)
    .sort((left, right) => left.localeCompare(right));
  return names.length === 0
    ? `Labels cleared by ${authorName}`
    : `Labels changed to ${names.join(", ")} by ${authorName}`;
}

async function writeSystemComments(
  store: TasksApiStore,
  taskId: string,
  authorName: string,
  bodies: readonly string[],
): Promise<void> {
  for (const body of bodies) {
    await store.tasks.createComment({
      taskId,
      kind: "system",
      authorName,
      body,
      notifiedCount: 0,
    });
  }
}

function attachmentMetadata(attachment: StoredAttachment): AttachmentMetadata {
  return {
    id: attachment.id,
    taskId: attachment.taskId,
    commentId: attachment.commentId,
    fileName: attachment.fileName,
    mime: attachment.mime,
    sizeBytes: attachment.sizeBytes,
    isImage: attachment.isImage,
    createdAt: attachment.createdAt,
  };
}

/** Every attachment reachable from these tasks (their own + their comments'). */
export async function attachmentsForTasks(
  store: FileTasksStore,
  taskIds: readonly string[],
): Promise<StoredAttachment[]> {
  const perTask = await Promise.all(
    taskIds.map(async (taskId) => {
      const ownAttachments = await store.listAttachmentsForTask(taskId);
      const comments = await store.listComments(taskId);
      const commentAttachments = await Promise.all(
        comments.map((comment) => store.listAttachmentsForComment(comment.id)),
      );
      return [...ownAttachments, ...commentAttachments.flat()];
    }),
  );
  return perTask.flat();
}

/**
 * Live display facts about an agent thread that authored a comment.
 *   - `title`: the current human title for the byline link, or null when it
 *     must be suppressed — a side chat (an internal conversation that must not
 *     surface a title/link) or a thread with only a blank/whitespace title.
 *   - `providerId`: the thread's live provider id, always present when the
 *     thread resolves (including side chats — a brand logo exposes no link).
 * A thread contributes no entry at all when it is deleted, hidden, or otherwise
 * inaccessible (the SDK read rejects), so callers fall back to `authorName`
 * with no link and no provider logo.
 */
interface AgentThreadInfo {
  title: string | null;
  providerId: string;
}

/**
 * Resolve {@link AgentThreadInfo} for each distinct agent thread that authored
 * one of `comments`, keyed by thread id, reading each thread once from the live
 * SDK so renames are reflected.
 */
async function resolveAgentThreadInfo(
  bb: BbPluginApi,
  comments: readonly StoredComment[],
): Promise<Map<string, AgentThreadInfo>> {
  const threadIds = new Set<string>();
  for (const comment of comments) {
    if (comment.kind === "agent" && comment.threadId !== null) {
      threadIds.add(comment.threadId);
    }
  }
  const infos = new Map<string, AgentThreadInfo>();
  await Promise.all(
    [...threadIds].map(async (threadId) => {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        const isSideChat = isSideChatShapedThread(thread);
        // Prefer the first non-blank candidate: a whitespace-only primary
        // title must not suppress a useful fallback. Side chats never surface
        // a title/link, but still expose their provider.
        const title = isSideChat
          ? undefined
          : [thread.title, thread.titleFallback].find(
              (candidate) => candidate !== null && candidate.trim() !== "",
            );
        infos.set(threadId, {
          title: title ?? null,
          providerId: thread.providerId,
        });
      } catch {
        // Deleted, hidden, or inaccessible threads leave no entry.
      }
    }),
  );
  return infos;
}

/**
 * Resolve a display badge ({@link CommentProvider}) for each provider id that
 * appears in `threadInfo`, keyed by provider id. `name`/`logoUrl` come from the
 * live host provider list (one call, only when at least one provider is
 * needed). A provider that is no longer installed — or a provider list that
 * fails to load — leaves no entry, and callers fall back to a badge carrying
 * the raw provider id so the UI can still render a brand glyph by id.
 */
async function resolveProviderBadges(
  bb: BbPluginApi,
  threadInfo: ReadonlyMap<string, AgentThreadInfo>,
): Promise<Map<string, CommentProvider>> {
  const providerIds = new Set(
    [...threadInfo.values()].map((info) => info.providerId),
  );
  const badges = new Map<string, CommentProvider>();
  if (providerIds.size === 0) return badges;
  let providers: Awaited<ReturnType<typeof bb.sdk.providers.list>>;
  try {
    providers = await bb.sdk.providers.list();
  } catch {
    // Host provider list unavailable: callers fall back to raw-id badges.
    return badges;
  }
  for (const provider of providers) {
    if (providerIds.has(provider.id)) {
      badges.set(provider.id, {
        id: provider.id,
        name: provider.displayName,
        logoUrl: provider.logoUrl,
      });
    }
  }
  return badges;
}

interface CreateCommentInput {
  taskId: string;
  kind: StoredComment["kind"];
  authorName: string;
  presetName: string | null;
  threadId: string | null;
  body: string;
  notify: boolean;
}

export async function createComment(
  bb: BbPluginApi,
  store: TasksApiStore,
  input: CreateCommentInput,
): Promise<StoredComment> {
  let comment = await store.transaction(() =>
    store.tasks.createComment({
      taskId: input.taskId,
      kind: input.kind,
      authorName: input.authorName,
      presetName: input.presetName,
      threadId: input.threadId,
      body: input.body,
      notifiedCount: 0,
    }),
  );

  if (input.notify) {
    const delivery = await deliverCommentToLatestAgent(bb, store.tasks, {
      taskId: comment.taskId,
      commentId: comment.id,
      body: comment.body,
      authorName: comment.authorName,
    });
    comment = await store.transaction(() =>
      store.tasks.updateComment(comment.id, {
        notifiedCount: delivery.notifiedCount,
      }),
    );
  }

  publishCommentsChanged(bb, input.taskId, comment.notifiedCount);
  return comment;
}

interface TaskPullRequestsResult {
  pullRequests: TaskPullRequest[];
  unavailableThreadIds: string[];
}

/** Cap on simultaneous environment PR lookups — each one may shell out to
 *  `gh` on the host, so a task with many worktrees must not stampede it. */
const PULL_REQUEST_LOOKUP_CONCURRENCY = 4;

/**
 * Run `work` over every item with at most `limit` invocations in flight.
 * Results keep item order. Rejections propagate to the caller.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await work(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Resolve the pull requests reachable from a task's attached threads: each
 * thread's environment PR (the branch its agent pushed), deduplicated by URL.
 * Thread metadata resolves concurrently, then threads are grouped by
 * environment so each distinct environment costs exactly one lookup, and
 * those lookups run with bounded concurrency. A thread lands in
 * `unavailableThreadIds` when its metadata cannot be read (deleted thread) or
 * its environment lookup reports/throws "unavailable" (gh missing, not
 * authenticated, unreachable workspace); threads with no environment or a
 * genuinely absent PR simply produce nothing.
 */
async function listTaskPullRequests(
  bb: BbPluginApi,
  store: TasksApiStore,
  taskId: string,
): Promise<TaskPullRequestsResult> {
  const taskThreads = await store.tasks.listTaskThreads(taskId);

  const unavailable = new Set<string>();
  const threadIdsByEnvironment = new Map<string, string[]>();
  await Promise.all(
    taskThreads.map(async (taskThread) => {
      try {
        const thread = await bb.sdk.threads.get({
          threadId: taskThread.threadId,
        });
        if (!thread.environmentId) return;
        const group = threadIdsByEnvironment.get(thread.environmentId) ?? [];
        group.push(taskThread.threadId);
        threadIdsByEnvironment.set(thread.environmentId, group);
      } catch {
        unavailable.add(taskThread.threadId);
      }
    }),
  );

  const byUrl = new Map<string, TaskPullRequest>();
  await mapWithConcurrency(
    [...threadIdsByEnvironment.entries()],
    PULL_REQUEST_LOOKUP_CONCURRENCY,
    async ([environmentId, threadIds]) => {
      let result: Awaited<
        ReturnType<BbPluginApi["sdk"]["environments"]["pullRequest"]>
      >;
      try {
        result = await bb.sdk.environments.pullRequest({ environmentId });
      } catch {
        for (const threadId of threadIds) unavailable.add(threadId);
        return;
      }
      if (result.outcome === "unavailable") {
        for (const threadId of threadIds) unavailable.add(threadId);
        return;
      }
      if (result.outcome === "absent") return;
      const { pullRequest } = result;
      const existing = byUrl.get(pullRequest.url);
      if (!existing) {
        byUrl.set(pullRequest.url, {
          url: pullRequest.url,
          number: pullRequest.number,
          title: pullRequest.title,
          state: pullRequest.state,
          updatedAt: pullRequest.updatedAt,
          threadIds: [...threadIds],
        });
        return;
      }
      // Two environments can surface the same PR (e.g. two worktrees on the
      // same branch). Union the threads and keep the freshest payload so a
      // stale duplicate never masks a newer state.
      const threadIdUnion = [...existing.threadIds, ...threadIds];
      if (pullRequest.updatedAt.localeCompare(existing.updatedAt) > 0) {
        byUrl.set(pullRequest.url, {
          url: pullRequest.url,
          number: pullRequest.number,
          title: pullRequest.title,
          state: pullRequest.state,
          updatedAt: pullRequest.updatedAt,
          threadIds: threadIdUnion,
        });
      } else {
        existing.threadIds = threadIdUnion;
      }
    },
  );

  // Keep both lists in stable task-thread order regardless of lookup timing.
  const threadOrder = new Map(
    taskThreads.map((taskThread, index) => [taskThread.threadId, index]),
  );
  const orderByThread = (threadId: string) =>
    threadOrder.get(threadId) ?? Number.MAX_SAFE_INTEGER;
  const pullRequests = [...byUrl.values()].map((pullRequest) => ({
    ...pullRequest,
    threadIds: [...pullRequest.threadIds].sort(
      (left, right) => orderByThread(left) - orderByThread(right),
    ),
  }));

  return {
    // Most recently updated first, matching how the threads list surfaces
    // the freshest work.
    pullRequests: pullRequests.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
    unavailableThreadIds: [...unavailable].sort(
      (left, right) => orderByThread(left) - orderByThread(right),
    ),
  };
}

export function registerHandlers(
  bb: BbPluginApi,
  store: TasksApiStore,
): PluginRpcHandlers<typeof tasksRpcContract> {
  return {
    createFolder(input) {
      const folder = store.tasks.createFolder(input);
      publishProjectsChanged(bb, null);
      return { folder };
    },
    renameFolder(input) {
      const folder = store.tasks.updateFolder(input.folderId, {
        name: input.name,
      });
      publishProjectsChanged(bb, null);
      return { folder };
    },
    moveFolder(input) {
      const folder = store.tasks.updateFolder(input.folderId, {
        parentFolderId: input.parentFolderId,
      });
      publishProjectsChanged(bb, null);
      return { folder };
    },
    deleteFolder(input) {
      const deleted = store.tasks.deleteFolder(input.folderId);
      if (deleted) publishProjectsChanged(bb, null);
      return { deleted };
    },
    listFolders() {
      return { folders: store.tasks.listFolders() };
    },
    async createProject(input) {
      const project = store.tasks.createProject(input);
      publishProjectsChanged(bb, project.id);
      return { project: await apiProject(store, project) };
    },
    async updateProject(input) {
      const { projectId, ...changes } = input;
      const project = store.tasks.updateProject(projectId, changes);
      publishProjectsChanged(bb, project.id);
      return { project: await apiProject(store, project) };
    },
    async renameProjectPrefix(input) {
      try {
        if (store.projectPrefixExists(input.prefix, input.projectId)) {
          fail(
            "project_prefix_conflict",
            `Project prefix is already in use: ${input.prefix}`,
          );
        }
        const project = store.tasks.updateProject(input.projectId, {
          prefix: input.prefix,
        });
        publishProjectsChanged(bb, project.id);
        return { ok: true, project: await apiProject(store, project) };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return projectFailure(error);
        throw error;
      }
    },
    async deleteProject(input) {
      try {
        if (!input.force && (await store.projectTaskCount(input.projectId)) > 0) {
          fail(
            "project_not_empty",
            "A project must be empty before it can be deleted; pass force: true to delete its tasks",
          );
        }
        const taskIds = (await store.tasks.listTasks({ projectId: input.projectId }))
          .map((task) => task.id);
        const attachments = await attachmentsForTasks(store.tasks, taskIds);
        const deleted = store.tasks.deleteProject(input.projectId);
        if (deleted) {
          await removeAttachmentBlobs(bb, store.tasks, attachments);
          publishProjectsChanged(bb, input.projectId);
        }
        return { ok: true, deleted };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return projectFailure(error);
        throw error;
      }
    },
    async listProjects(input) {
      return {
        projects: await Promise.all(
          store.tasks
            .listProjects(input.folderId)
            .map((project) => apiProject(store, project)),
        ),
      };
    },
    async createTask(input) {
      try {
        await validateTaskParent(store, input.projectId, input.parentTaskId);
        const task = await store.transaction(async () => {
          const created = await store.tasks.createTask({
            projectId: input.projectId,
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            type: input.type,
            estimate: input.estimate,
            plannedMinutes: input.plannedMinutes,
            actualMinutes: input.actualMinutes,
            budget: input.budget,
            budgetLimit: input.budgetLimit,
            cost: input.cost,
            checks: input.checks,
            dueDate: input.dueDate,
            parentTaskId: input.parentTaskId,
            assignee: input.assignee,
            epic: input.epic,
          });
          await replaceTaskLabels(store, created.id, input.labelIds);
          return apiTask(store, (await store.tasks.getTask(created.id))!);
        });
        publishTasksChanged(bb, task.id, task.projectId);
        return { ok: true, task };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return taskFailure(error);
        throw error;
      }
    },
    async getTask(input) {
      const task = await store.tasks.getTask(input.taskId);
      return { task: task ? apiTask(store, task) : null };
    },
    async getTaskByKey(input) {
      const task = await store.tasks.getTaskByKey(input.taskKey);
      return { task: task ? apiTask(store, task) : null };
    },
    async updateTask(input) {
      try {
        const current = await store.tasks.getTask(input.taskId);
        if (!current) throw new Error(`Task not found: ${input.taskId}`);
        const parentTaskId =
          input.parentTaskId === undefined
            ? current.parentTaskId
            : input.parentTaskId;
        await validateTaskParent(store, current.projectId, parentTaskId, current.id);

        const result = await store.transaction(async () => {
          const beforeLabelIds = (await store.tasks.listTaskLabels(current.id))
            .map((link) => link.labelId);
          const updated = await store.tasks.updateTask(current.id, {
            slug: input.slug,
            key: input.key,
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            type: input.type,
            estimate: input.estimate,
            plannedMinutes: input.plannedMinutes,
            actualMinutes: input.actualMinutes,
            budget: input.budget,
            budgetLimit: input.budgetLimit,
            cost: input.cost,
            checks: input.checks,
            dueDate: input.dueDate,
            parentTaskId: input.parentTaskId,
            assignee: input.assignee,
            epic: input.epic,
          });
          // From here on the task answers to `updated.id` — a slug change
          // renamed the file and the id with it.
          if (input.labelIds) {
            await replaceTaskLabels(store, updated.id, input.labelIds);
          }

          const bodies: string[] = [];
          if (updated.status !== current.status) {
            bodies.push(
              `Status changed to ${statusName(updated.status)} by ${input.authorName}`,
            );
            store.transitions.record({
              taskId: updated.id,
              projectId: updated.projectId,
              fromStatus: current.status,
              toStatus: updated.status,
              atMs: Date.now(),
              actor: input.authorName,
            });
          }
          if (updated.priority !== current.priority) {
            bodies.push(
              `Priority changed to ${priorityName(updated.priority)} by ${input.authorName}`,
            );
          }
          if (updated.dueDate !== current.dueDate) {
            bodies.push(
              updated.dueDate === null
                ? `Due date removed by ${input.authorName}`
                : `Due date changed to ${updated.dueDate} by ${input.authorName}`,
            );
          }
          if (input.labelIds && labelsChanged(beforeLabelIds, input.labelIds)) {
            bodies.push(await labelChangeBody(store, updated.id, input.authorName));
          }
          await writeSystemComments(store, updated.id, input.authorName, bodies);
          return {
            task: apiTask(store, (await store.tasks.getTask(updated.id))!),
            systemCommentsWritten: bodies.length,
          };
        });

        publishTasksChanged(bb, result.task.id, result.task.projectId);
        if (result.systemCommentsWritten > 0) {
          publishCommentsChanged(bb, result.task.id);
        }
        return { ok: true, task: result.task };
      } catch (error) {
        if (error instanceof TasksDomainFailure) return taskFailure(error);
        throw error;
      }
    },
    async deleteTask(input) {
      const task = await store.tasks.getTask(input.taskId);
      const attachments = await attachmentsForTasks(store.tasks, [input.taskId]);
      const deleted = await store.tasks.deleteTask(input.taskId);
      if (deleted && task) {
        await removeAttachmentBlobs(bb, store.tasks, attachments);
        publishTasksChanged(bb, task.id, task.projectId);
      }
      return { deleted };
    },
    async revealTaskSource(input) {
      const task = await store.tasks.getTask(input.taskId);
      if (!task) return { revealed: false, error: "Task not found" };
      const filePath = resolveTaskSourcePath(task);
      if (!filePath) {
        return { revealed: false, error: "The task has no source file" };
      }
      const project = store.tasks.getProject(task.projectId);
      if (!project?.linkedBbProjectId) {
        return {
          revealed: false,
          error: "The task's project isn't linked to a bb project",
        };
      }
      try {
        const bbProject = await bb.sdk.projects.get({
          projectId: project.linkedBbProjectId,
        });
        const source =
          bbProject.sources.find((entry) => entry.isDefault) ??
          bbProject.sources[0];
        if (!source) {
          return { revealed: false, error: "The bb project has no source" };
        }
        // Finder belongs to the machine running bb's server: only reveal a
        // source whose host is that primary/local host, never a remote one.
        const { primaryHostId } = await bb.sdk.system.config();
        if (primaryHostId === null || source.hostId !== primaryHostId) {
          return {
            revealed: false,
            error: "Only a local source can be revealed in Finder",
          };
        }
        const absPath = resolveSourceAbsPath(source.path, filePath);
        if (!absPath) {
          return {
            revealed: false,
            error: "The file path is outside the repository",
          };
        }
        return await revealInFinderHere(absPath);
      } catch (error) {
        return {
          revealed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async listTasks(input) {
      const page = await store.tasks.listTasksPage({
        projectId: input.projectId,
        statuses: input.statuses,
        priorities: input.priorities,
        labelIds: input.labelIds,
        activeOnly: input.activeOnly,
        waitingOnly: input.waitingOnly,
        parentTaskId: input.parentTaskId,
        search: input.search,
        sort: input.sort,
        limit: input.limit,
        cursor: input.cursor,
      });
      return {
        tasks: apiTasks(store, page.tasks),
        nextCursor: page.nextCursor,
      };
    },
    async boardMove(input) {
      const current = await store.tasks.getTask(input.taskId);
      if (!current) throw new Error(`Task not found: ${input.taskId}`);
      const result = await store.transaction(async () => {
        // Board columns are statuses; there is no manual order within a
        // column to preserve (see decisions/tasks-files-are-the-store.md) —
        // beforeTaskId/afterTaskId are accepted for wire compatibility but
        // unused.
        const moved = await store.tasks.updateTask(current.id, { status: input.status });
        const statusChanged = moved.status !== current.status;
        if (statusChanged) {
          // Record before the system comment (a separate md write that could
          // fail): the transition log is the source of truth for "every
          // transition writes a row", and mirrors updateTask's own order.
          store.transitions.record({
            taskId: moved.id,
            projectId: moved.projectId,
            fromStatus: current.status,
            toStatus: moved.status,
            atMs: Date.now(),
            actor: input.authorName,
          });
          await writeSystemComments(store, current.id, input.authorName, [
            `Status changed to ${statusName(moved.status)} by ${input.authorName}`,
          ]);
        }
        return { task: apiTask(store, (await store.tasks.getTask(moved.id))!), statusChanged };
      });
      publishTasksChanged(bb, result.task.id, result.task.projectId);
      if (result.statusChanged) publishCommentsChanged(bb, result.task.id);
      return { ok: true, task: result.task };
    },
    createLabel(input) {
      const label = store.tasks.createLabel(input);
      publishProjectsChanged(bb, label.projectId);
      return { label };
    },
    async updateLabel(input) {
      const label = await store.tasks.updateLabel(input.labelId, {
        name: input.name,
        color: input.color,
      });
      publishProjectsChanged(bb, label.projectId);
      return { label };
    },
    async deleteLabel(input) {
      const label = await store.tasks.getLabel(input.labelId);
      const deleted = await store.tasks.deleteLabel(input.labelId);
      if (deleted && label) publishProjectsChanged(bb, label.projectId);
      return { deleted };
    },
    async listPlacements(input) {
      return store.tasks.listPlacements(input.projectId);
    },
    async listLabels(input) {
      return { labels: await store.tasks.listLabels(input.projectId) };
    },
    async createComment(input) {
      const comment = await createComment(bb, store, {
        taskId: input.taskId,
        kind: "user",
        authorName: "You",
        presetName: null,
        threadId: null,
        body: input.body,
        notify: input.notify,
      });
      return { comment };
    },
    async listComments(input) {
      const comments = await store.tasks.listComments(input.taskId);
      const threadInfo = await resolveAgentThreadInfo(bb, comments);
      const providerBadges = await resolveProviderBadges(bb, threadInfo);
      return {
        comments: comments.map((comment) => {
          const info =
            comment.kind === "agent" && comment.threadId !== null
              ? threadInfo.get(comment.threadId)
              : undefined;
          return {
            ...comment,
            threadTitle: info?.title ?? null,
            provider:
              info === undefined
                ? null
                : (providerBadges.get(info.providerId) ?? {
                    id: info.providerId,
                    name: info.providerId,
                    logoUrl: null,
                  }),
          };
        }),
      };
    },
    async listAttachments(input) {
      const attachments =
        "taskId" in input
          ? await store.tasks.listAttachmentsForTask(input.taskId)
          : await store.tasks.listAttachmentsForComment(input.commentId);
      return {
        attachments: attachments.map(attachmentMetadata),
      };
    },
    async deleteAttachment(input) {
      try {
        const attachment = await deleteAttachmentById(
          bb,
          store.tasks,
          input.attachmentId,
          {
            removeDescriptionReferences: input.removeDescriptionReferences,
          },
        );
        return attachment
          ? {
              ok: true,
              deleted: true,
              attachment: attachmentMetadata(attachment),
            }
          : { ok: true, deleted: false, attachment: null };
      } catch (error) {
        if (error instanceof AttachmentReferencedError) {
          return {
            ok: false,
            error: {
              code: "attachment_referenced",
              message: error.message,
            },
          };
        }
        throw error;
      }
    },
    async listTaskThreads(input) {
      return { taskThreads: await store.tasks.listTaskThreads(input.taskId) };
    },
    async tasksForThread(input) {
      return {
        tasks: apiTasks(store, await store.tasks.listTasksForThread(input.threadId)),
      };
    },
    async listTaskPullRequests(input) {
      return listTaskPullRequests(bb, store, input.taskId);
    },
    createPreset(input) {
      const preset = store.tasks.createPreset({ ...input, builtin: false });
      publishProjectsChanged(bb, null);
      return { preset };
    },
    updatePreset(input) {
      const { presetId, ...changes } = input;
      const preset = store.tasks.updatePreset(
        presetId,
        changes.environmentKind === "project-default"
          ? { ...changes, baseBranch: null, machineId: null }
          : changes,
      );
      publishProjectsChanged(bb, null);
      return { preset };
    },
    deletePreset(input) {
      const deleted = store.tasks.deletePreset(input.presetId);
      if (deleted) publishProjectsChanged(bb, null);
      return { deleted };
    },
    listPresets() {
      return { presets: store.tasks.listPresets() };
    },
    listSavedViews(input) {
      return { savedViews: store.tasks.listSavedViews(input.scope) };
    },
    createSavedView(input) {
      const savedView = store.tasks.createSavedView(input);
      publishViewsChanged(bb);
      return { savedView };
    },
    deleteSavedView(input) {
      const deleted = store.tasks.deleteSavedView(input.savedViewId);
      if (deleted) publishViewsChanged(bb);
      return { deleted };
    },
    async listProviders() {
      const providers = await bb.sdk.providers.list();
      return {
        providers: providers.map((provider) => ({
          id: provider.id,
          name: provider.displayName,
          permissionModes:
            provider.capabilities.permissionModes,
        })),
      };
    },
    async listProviderModels(input) {
      const result = await bb.sdk.providers.models({
        providerId: input.providerId,
      });
      const supportedReasoningLevels = new Set(
        result.models.flatMap((model) =>
          model.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
          ),
        ),
      );
      const reasoningLevels = PRESET_REASONING_LEVELS.filter((level) =>
        supportedReasoningLevels.has(level),
      );
      return {
        models: result.models.map((model) => ({
          id: model.model,
          name: model.displayName,
          isDefault: model.isDefault,
        })),
        // The SDK has model-level reasoning metadata but no provider-level
        // list. Fall back to the standard picker levels when models omit it.
        reasoningLevels:
          reasoningLevels.length > 0
            ? reasoningLevels
            : [...PRESET_REASONING_LEVELS],
      };
    },
    async listMachines() {
      const machines = await bb.sdk.hosts.list();
      return {
        machines: machines.map((machine) => ({
          id: machine.id,
          name: machine.name,
        })),
      };
    },
    async searchThreads(input) {
      const query = input.query.trim();
      const limit = Math.min(input.limit ?? MAX_THREAD_SEARCH_RESULTS, 10);
      const candidates =
        query.length >= 2
          ? await bb.sdk.threads.search({
              query,
              limitPerGroup: String(MAX_THREAD_SEARCH_RESULTS),
            })
          : null;
      const threads = candidates
        ? [...candidates.active.results, ...candidates.archived.results].map(
            (result) => result.thread,
          )
        : (
            await bb.sdk.threads.list({
              limit: MAX_THREAD_SEARCH_RESULTS,
            })
          ).filter((thread) => {
            if (query.length === 0) return true;
            const title = thread.title ?? thread.titleFallback ?? "";
            return title
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase());
          });
      return {
        threads: threads
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, limit)
          .map((thread) => ({
            id: thread.id,
            title: thread.title ?? thread.titleFallback ?? "Untitled thread",
            status: thread.status,
          })),
      };
    },
    async listBbProjects() {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return {
        bbProjects: projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
      };
    },
    async sidebarOpenTaskCount() {
      return { openTaskCount: await store.openTaskCount() };
    },
    async sidebarSummary() {
      return { projects: await store.sidebarSummary() };
    },
    async analyticsSnapshot(input) {
      const tasks = await store.tasks.listTasks(
        input.projectId != null ? { projectId: input.projectId } : {},
      );
      return snapshotOf(tasks);
    },
    analyticsSeries(input) {
      const rows = store.transitions.range(
        input.fromMs,
        input.toMs,
        input.projectId != null ? { projectId: input.projectId } : undefined,
      );
      return seriesFromTransitions(rows, {
        fromMs: input.fromMs,
        toMs: input.toMs,
        binMs: input.binMs,
      });
    },
  };
}

export function registerTasksApi(
  bb: BbPluginApi,
  store: TasksApiStore,
  callerEnvironments: CallerEnvironmentCache,
): void {
  // Область вызова открывается здесь, вокруг обработчиков: до этого её знал
  // только CLI, и запрос от интерфейса всегда выглядел бестредовым — см.
  // api/caller-scope.ts.
  bb.rpc.register(
    tasksRpcContract,
    withCallerScope(callerEnvironments, registerHandlers(bb, store)),
  );
}
