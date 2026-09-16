import type { BbPluginApi, PluginMentionItem } from "@get-bb/plugin-sdk";

import type { TasksApiStore } from "../api";
import { attachmentsForTasks } from "../api/index.js";
import type { Attachment, TaskThread } from "../db";
import type { Comment, Task } from "../shared/contract.js";

const SEARCH_LIMIT = 10;
const RECENT_COMMENT_LIMIT = 5;

function displayName(value: string): string {
  return value
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

/**
 * Tasks matching `query` (an empty query matches everything — see
 * filesync/query.ts's `matchesSearch`), boards linked to the calling bb
 * project sorted first, then most recently updated.
 */
async function searchTasks(
  store: TasksApiStore,
  query: string,
  bbProjectId: string | null,
): Promise<PluginMentionItem[]> {
  const linkedProjectIds = new Set(
    store.tasks
      .listProjects()
      .filter((project) => bbProjectId !== null && project.linkedBbProjectId === bbProjectId)
      .map((project) => project.id),
  );

  const results = (await store.tasks.listTasks({ search: query }))
    .sort((a, b) => {
      const aLinked = linkedProjectIds.has(a.projectId) ? 0 : 1;
      const bLinked = linkedProjectIds.has(b.projectId) ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    })
    .slice(0, SEARCH_LIMIT);

  return results.map((task) => {
    const project = store.tasks.getProject(task.projectId);
    return {
      id: task.id,
      title: `${task.key} · ${task.title}`,
      subtitle: `${project?.name ?? ""} · ${displayName(task.status)}`,
    };
  });
}

function formatSubtasks(subtasks: readonly Task[]): string {
  if (subtasks.length === 0) return "None.";
  return subtasks
    .map(
      (subtask) =>
        `- ${subtask.key} · ${subtask.title} — ${displayName(subtask.status)}`,
    )
    .join("\n");
}

function formatAttachments(
  attachments: readonly Pick<Attachment, "id" | "fileName">[],
): string {
  if (attachments.length === 0) return "None.";
  return attachments
    .map(
      (attachment) =>
        `- ${attachment.id} · ${attachment.fileName}\n` +
        `  Fetch with: bb tasks attachment get ${attachment.id} --out <path>`,
    )
    .join("\n");
}

function formatComments(comments: readonly Comment[]): string {
  if (comments.length === 0) return "None.";
  return comments
    .map(
      (comment) =>
        `### ${comment.authorName} · ${displayName(comment.kind)} · ${comment.createdAt}\n\n${comment.body}`,
    )
    .join("\n\n");
}

function formatThreads(threads: readonly TaskThread[]): string {
  if (threads.length === 0) return "None.";
  return threads
    .map(
      (thread) =>
        `- ${thread.threadId} · ${thread.title} · ${displayName(thread.liveStatus)}`,
    )
    .join("\n");
}

async function buildTaskContext(store: TasksApiStore, taskId: string): Promise<string> {
  const task = await store.tasks.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const project = store.tasks.getProject(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

  const labels = await store.tasks.listLabelsForTask(task.id);
  const comments = (await store.tasks.listComments(task.id))
    .slice(-RECENT_COMMENT_LIMIT);
  const attachments = await attachmentsForTasks(store.tasks, [task.id]);
  const subtasks = await store.tasks.listSubtasks(task.id);
  const threads = await store.tasks.listTaskThreads(task.id);

  return `# ${task.key} · ${task.title}

## Task details

- Status: ${displayName(task.status)}
- Priority: ${displayName(task.priority)}
- Labels: ${labels.length > 0 ? labels.map((label) => label.name).join(", ") : "None"}
- Due: ${task.dueDate ?? "None"}
- Project: ${project.name}

## Description

${task.description.trim() || "No description provided."}

## Sub-tasks

${formatSubtasks(subtasks)}

## Attachments

${formatAttachments(attachments)}

## Last 5 comments

${formatComments(comments)}

## Attached threads

${formatThreads(threads)}

## Action contract

You can act on this task with the bb tasks CLI. If you begin working on it, first run: bb tasks attach ${task.key} (attaches THIS thread so the task shows you as working). Comment substantive updates via bb tasks comment ${task.key} --body ... and set status via bb tasks update ${task.key} --status ...
`;
}

export function registerMentions(bb: BbPluginApi, store: TasksApiStore): void {
  bb.ui.registerMentionProvider({
    id: "task",
    label: "Tasks",
    async search({ query, projectId }) {
      return searchTasks(store, query, projectId);
    },
    async resolve(itemId) {
      return { context: await buildTaskContext(store, itemId) };
    },
  });
}
