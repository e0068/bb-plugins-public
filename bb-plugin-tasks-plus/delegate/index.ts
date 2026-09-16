import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Attachment, Preset } from "../db/types.js";
import type { BoardConfig as Project } from "../filesync/board-config.js";
import type { FileTasksStore } from "../filesync/store.js";
import type { TasksApiStore } from "../api";
import {
  presetPermissionModeSchema,
  type Comment,
  type CommentsChangedEvent,
  type Task,
  type TasksChangedEvent,
  type ThreadsChangedEvent,
} from "../shared/contract";
import { delegationRpcContract } from "./contract";
import { withCallerScope } from "../api/caller-scope.js";
import type { CallerEnvironmentCache } from "../filesync/caller-cache.js";
import { threadLiveState } from "../threads/live-state.js";

const MAX_DELEGATED_THREAD_TITLE_LENGTH = 120;
const SYSTEM_AUTHOR_NAME = "Tasks";
const MANUAL_PRESET_NAME = "Attached";

const presetExecutionSchema = z
  .object({
    providerId: z.string().trim().min(1),
    model: z.string().trim().min(1),
    reasoningLevel: z.enum([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
      "ultra",
    ]),
    permissionMode: presetPermissionModeSchema,
  })
  .strict();

export type DelegationErrorCode = "project_not_linked" | "spawn_target_invalid";

export class DelegationError extends Error {
  constructor(
    readonly code: DelegationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DelegationError";
  }
}

export interface SeedPromptInput {
  task: Task;
  project: Project;
  subtasks: readonly Task[];
  attachments: readonly Pick<Attachment, "id" | "fileName">[];
  recentComments: readonly Comment[];
  presetInstructions: string;
  extraInstructions?: string;
}

function markdownSection(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

function formatSubtasks(subtasks: readonly Task[]): string {
  if (subtasks.length === 0) return "None.";
  return subtasks
    .map((subtask) => `- ${subtask.key} · ${subtask.title} (${subtask.status})`)
    .join("\n");
}

function formatAttachments(
  attachments: readonly Pick<Attachment, "id" | "fileName">[],
): string {
  if (attachments.length === 0) return "None.";
  return attachments
    .map(
      (attachment) =>
        `- ${attachment.fileName} · ${attachment.id}\n` +
        `  Fetch with: bb tasks attachment get ${attachment.id} --out <path>`,
    )
    .join("\n");
}

function formatComments(comments: readonly Comment[]): string {
  if (comments.length === 0) return "None.";
  return comments
    .map(
      (comment) =>
        `### ${comment.authorName} · ${comment.kind} · ${comment.createdAt}\n\n${comment.body}`,
    )
    .join("\n\n");
}

export function buildSeedPrompt(input: SeedPromptInput): string {
  const sections = [
    `# ${input.task.key} · ${input.task.title}`,
    markdownSection(
      "Description",
      input.task.description.trim() || "No description provided.",
    ),
    markdownSection(
      "Project context",
      `- Name: ${input.project.name}\n- Linked bb project: ${input.project.linkedBbProjectId ?? "Not linked"}`,
    ),
    markdownSection("Sub-tasks", formatSubtasks(input.subtasks)),
    markdownSection("Attachments", formatAttachments(input.attachments)),
    markdownSection("Recent comments", formatComments(input.recentComments)),
    markdownSection(
      "Report-back contract",
      `You are working on task ${input.task.key}. Use the bb tasks CLI: comment substantive updates (bb tasks comment ${input.task.key} --body ...), attach result artifacts, set status when done (bb tasks update ${input.task.key} --status in_review) or explain blockage in a comment. Your thread is already attached to the task; run bb tasks current to reread which task(s) it solves.`,
    ),
  ];

  if (input.presetInstructions.trim()) {
    sections.push(
      markdownSection("Preset instructions", input.presetInstructions.trim()),
    );
  }
  if (input.extraInstructions?.trim()) {
    sections.push(
      markdownSection(
        "Additional instructions",
        input.extraInstructions.trim(),
      ),
    );
  }

  return `${sections.join("\n\n")}\n`;
}

function delegatedThreadTitle(task: Task): string {
  return `${task.key} · ${task.title}`.slice(
    0,
    MAX_DELEGATED_THREAD_TITLE_LENGTH,
  );
}

async function requireTask(store: FileTasksStore, taskId: string): Promise<Task> {
  const task = await store.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function requireProject(store: FileTasksStore, projectId: string): Project {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

function requirePreset(store: FileTasksStore, presetId: string): Preset {
  const preset = store.getPreset(presetId);
  if (!preset) throw new Error(`Preset not found: ${presetId}`);
  return preset;
}

function requireLinkedBbProject(project: Project): string {
  if (project.linkedBbProjectId) return project.linkedBbProjectId;
  throw new DelegationError(
    "project_not_linked",
    `Task project "${project.name}" is not linked to a bb project`,
  );
}

async function collectAttachments(
  store: FileTasksStore,
  taskId: string,
  comments: readonly Comment[],
): Promise<Attachment[]> {
  const attachments = new Map<string, Attachment>();
  for (const attachment of await store.listAttachmentsForTask(taskId)) {
    attachments.set(attachment.id, attachment);
  }
  for (const comment of comments) {
    for (const attachment of await store.listAttachmentsForComment(comment.id)) {
      attachments.set(attachment.id, attachment);
    }
  }
  return [...attachments.values()];
}

type SpawnEnvironment = Parameters<
  BbPluginApi["sdk"]["threads"]["spawn"]
>[0]["environment"];

async function presetSpawnEnvironment(
  bb: BbPluginApi,
  preset: Preset,
): Promise<SpawnEnvironment> {
  if (preset.environmentKind === "project-default") {
    return { type: "project-default" };
  }

  const hostId =
    preset.machineId ?? (await bb.sdk.system.config()).primaryHostId;
  if (hostId === null) {
    throw new DelegationError(
      "spawn_target_invalid",
      "Could not create a worktree because BB has no default machine",
    );
  }
  return {
    type: "host",
    hostId,
    workspace: {
      type: "managed-worktree",
      baseBranch:
        preset.baseBranch === null
          ? { kind: "default" }
          : { kind: "named", name: preset.baseBranch },
    },
  };
}

function isBbHttpError(
  error: unknown,
): error is Error & { code: string | null; status: number } {
  return (
    error instanceof Error &&
    "code" in error &&
    (typeof error.code === "string" || error.code === null) &&
    "status" in error &&
    typeof error.status === "number"
  );
}

const SPAWN_TARGET_ERROR_CODES = new Set([
  "host_not_found",
  "host_unavailable",
  "invalid_request",
  "project_unavailable",
  "unsupported_host",
  "workspace_unavailable",
]);

function mapSpawnTargetError(error: unknown, preset: Preset): never {
  if (
    preset.environmentKind === "new-worktree" &&
    isBbHttpError(error) &&
    error.code !== null &&
    SPAWN_TARGET_ERROR_CODES.has(error.code)
  ) {
    const machine = preset.machineId ?? "the default machine";
    const branch = preset.baseBranch ?? "the default branch";
    const detail = error.message.replace(/^HTTP \d+:\s*/u, "");
    throw new DelegationError(
      "spawn_target_invalid",
      `Could not create a worktree on ${machine} from ${branch}: ${detail}`,
    );
  }
  throw error;
}

/**
 * backlog/todo → in_progress the moment a thread gets linked to a task —
 * whether that link comes from a board dispatch or from `bb tasks attach`.
 * No-op once the task is already in_progress or further along, so a second
 * thread attaching to the same task never bounces its status backwards.
 */
export async function promoteToInProgressOnThreadLink(
  store: TasksApiStore,
  task: Task,
  presetName: string,
  threadId: string,
  reasonBody: string,
): Promise<void> {
  if (task.status !== "backlog" && task.status !== "todo") return;
  await store.tasks.updateTask(task.id, { status: "in_progress" });
  await createSystemComment(store.tasks, {
    taskId: task.id,
    presetName,
    threadId,
    body: reasonBody,
  });
}

export async function createSystemComment(
  store: FileTasksStore,
  input: {
    taskId: string;
    presetName: string;
    threadId: string;
    body: string;
  },
): Promise<void> {
  await store.createComment({
    taskId: input.taskId,
    kind: "system",
    authorName: SYSTEM_AUTHOR_NAME,
    presetName: input.presetName,
    threadId: input.threadId,
    body: input.body,
    notifiedCount: 0,
  });
}

export function publishThreadsChanged(bb: BbPluginApi, taskId: string): void {
  const payload: ThreadsChangedEvent = { taskId };
  bb.realtime.publish("threads:changed", payload);
}

function publishTasksChanged(
  bb: BbPluginApi,
  taskId: string,
  projectId: string,
): void {
  const payload: TasksChangedEvent = { taskId, projectId };
  bb.realtime.publish("tasks:changed", payload);
}

export function publishCommentsChanged(bb: BbPluginApi, taskId: string): void {
  const payload: CommentsChangedEvent = { taskId };
  bb.realtime.publish("comments:changed", payload);
}

export function handlers(
  bb: BbPluginApi,
  store: TasksApiStore,
): PluginRpcHandlers<typeof delegationRpcContract> {
  return {
    async delegate(input) {
      const task = await requireTask(store.tasks, input.taskId);
      const project = requireProject(store.tasks, task.projectId);
      const linkedBbProjectId = requireLinkedBbProject(project);
      const preset = requirePreset(store.tasks, input.presetId);
      const comments = await store.tasks.listComments(task.id);
      const recentComments = comments.slice(-5);
      const title = delegatedThreadTitle(task);
      const execution = presetExecutionSchema.parse({
        providerId: preset.providerId,
        model: preset.modelId,
        reasoningLevel: preset.reasoningLevel,
        permissionMode: preset.permissionMode,
      });
      const prompt = buildSeedPrompt({
        task,
        project,
        subtasks: await store.tasks.listSubtasks(task.id),
        attachments: await collectAttachments(store.tasks, task.id, comments),
        recentComments,
        presetInstructions: preset.instructions,
        extraInstructions: input.extraInstructions,
      });

      const environment = await presetSpawnEnvironment(bb, preset);
      const thread = await bb.sdk.threads
        .spawn({
          projectId: linkedBbProjectId,
          environment,
          providerId: execution.providerId,
          model: execution.model,
          reasoningLevel: execution.reasoningLevel,
          permissionMode: execution.permissionMode,
          title,
          prompt,
        })
        .catch((error: unknown) => mapSpawnTargetError(error, preset));

      const taskThread = await store.transaction(async () => {
        store.tasks.setThreadLiveState(thread.id, {
          liveStatus: "starting",
          archivedAt: null,
        });
        const attached = await store.tasks.upsertTaskThread({
          taskId: task.id,
          threadId: thread.id,
          presetName: preset.name,
          title,
        });

        await promoteToInProgressOnThreadLink(
          store,
          task,
          preset.name,
          thread.id,
          `Status changed to In Progress · dispatched to ${preset.name}`,
        );

        await createSystemComment(store.tasks, {
          taskId: task.id,
          presetName: preset.name,
          threadId: thread.id,
          body: `Dispatched to ${preset.name}`,
        });
        return attached;
      });

      try {
        store.tasks.setThreadLiveState(
          thread.id,
          threadLiveState(await bb.sdk.threads.get({ threadId: thread.id })),
        );
      } catch (error) {
        bb.log.warn(
          `Could not read delegated thread ${thread.id} after attach: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      publishThreadsChanged(bb, task.id);
      publishTasksChanged(bb, task.id, task.projectId);
      publishCommentsChanged(bb, task.id);
      return { threadId: thread.id };
    },

    async taskThreadsAttach(input) {
      const task = await requireTask(store.tasks, input.taskId);
      const thread = await bb.sdk.threads.get({ threadId: input.threadId });
      const title = (
        thread.title ??
        thread.titleFallback ??
        delegatedThreadTitle(task)
      ).slice(0, MAX_DELEGATED_THREAD_TITLE_LENGTH);

      await store.transaction(async () => {
        store.tasks.setThreadLiveState(thread.id, threadLiveState(thread));
        await store.tasks.upsertTaskThread({
          taskId: task.id,
          threadId: thread.id,
          presetName: MANUAL_PRESET_NAME,
          title,
        });

        await promoteToInProgressOnThreadLink(
          store,
          task,
          MANUAL_PRESET_NAME,
          thread.id,
          "Status changed to In Progress · thread attached",
        );
      });

      publishThreadsChanged(bb, task.id);
      publishTasksChanged(bb, task.id, task.projectId);
      return { threadId: thread.id };
    },
  };
}

export function registerDelegation(
  bb: BbPluginApi,
  store: TasksApiStore,
  callerEnvironments: CallerEnvironmentCache,
): void {
  // Кнопка «Делегировать» стоит в панели треда, поэтому её вызов обязан
  // знать рабочее дерево так же, как остальные задачные методы: иначе
  // задача ветки для неё не существует, а общая правится в main.
  bb.rpc.register(
    delegationRpcContract,
    withCallerScope(callerEnvironments, handlers(bb, store)),
  );
}
