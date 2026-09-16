import type { TaskSort } from "../shared/pagination.js";
import type {
  FieldDisplayConfig,
  PresetPermissionMode,
} from "../shared/contract.js";

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_TYPES = [
  "feature",
  "bugfix",
  "spike",
  "refactor",
  "migration",
  "design",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_ESTIMATES = ["xs", "s", "m", "l", "xl"] as const;

export type TaskEstimate = (typeof TASK_ESTIMATES)[number];

export const TASK_CHECKS = ["test", "review", "design", "browser"] as const;

export type TaskCheck = (typeof TASK_CHECKS)[number];

export const COMMENT_KINDS = ["user", "agent", "system"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const TASK_THREAD_LIVE_STATUSES = [
  "starting",
  "working",
  "idle",
  "completed",
  "failed",
] as const;

export type TaskThreadLiveStatus = (typeof TASK_THREAD_LIVE_STATUSES)[number];

export const PRESET_ENVIRONMENT_KINDS = [
  "project-default",
  "new-worktree",
] as const;

export type PresetEnvironmentKind = (typeof PRESET_ENVIRONMENT_KINDS)[number];

export interface Folder {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
}

/**
 * Where a task's backing markdown file was last read from: the linked bb
 * project's main checkout, or дерево вызвавшего треда (окружение из
 * filesync/caller-root.ts), чья копия файла расходится с main (см.
 * filesync/fs-boards.ts).
 */
export type FileTaskOrigin =
  | { kind: "main" }
  | {
      kind: "worktree";
      environmentId: string;
      name: string | null;
      branchName: string | null;
    };

export interface Comment {
  id: string;
  taskId: string;
  kind: CommentKind;
  authorName: string;
  presetName: string | null;
  threadId: string | null;
  body: string;
  notifiedCount: number;
  createdAt: string;
}

export interface Attachment {
  id: string;
  taskId: string | null;
  commentId: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  blobPath: string;
  isImage: boolean;
  createdAt: string;
}

/**
 * A thread attached to a task, as the plugin serves it: the attachment fact
 * from the task file plus the thread's current state, read from bb at
 * request time and never stored (see threads/live-state.ts and
 * memory/decisions/tasks-plus-thread-state-is-not-a-file-field.md).
 */
export interface TaskThread {
  id: string;
  taskId: string;
  threadId: string;
  presetName: string;
  title: string;
  liveStatus: TaskThreadLiveStatus;
  /** Set when the underlying bb thread is archived; independent of liveStatus — see memory/decisions/tasks-plus-thread-archived-separate-column.md. */
  archivedAt: string | null;
  attachedAt: string;
}

export interface Preset {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: PresetPermissionMode;
  environmentKind: PresetEnvironmentKind;
  baseBranch: string | null;
  machineId: string | null;
  instructions: string;
  builtin: boolean;
  createdAt: string;
}

export interface CreateFolderInput {
  id?: string;
  name: string;
  parentFolderId?: string | null;
}

export interface UpdateFolderInput {
  name?: string;
  parentFolderId?: string | null;
}

export interface CreateTaskInput {
  id?: string;
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType | null;
  estimate?: TaskEstimate | null;
  plannedMinutes?: number | null;
  actualMinutes?: number | null;
  budget?: number | null;
  budgetLimit?: number | null;
  cost?: number | null;
  checks?: readonly TaskCheck[];
  dueDate?: string | null;
  parentTaskId?: string | null;
  /** Folder above the status folder; null keeps the task at the root. */
  assignee?: string | null;
  /** Folder inside the assignee's; needs an assignee. */
  epic?: string | null;
}

export interface UpdateTaskInput {
  /** New file name; the task's id changes with it (filesync/assemble.ts). */
  slug?: string;
  /** The board's label: a `PREFIX-NUMBER` to set, null to take it off. */
  key?: string | null;
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType | null;
  estimate?: TaskEstimate | null;
  plannedMinutes?: number | null;
  actualMinutes?: number | null;
  budget?: number | null;
  budgetLimit?: number | null;
  cost?: number | null;
  checks?: readonly TaskCheck[];
  dueDate?: string | null;
  parentTaskId?: string | null;
  /** Folder above the status folder; null keeps the task at the root. */
  assignee?: string | null;
  /** Folder inside the assignee's; needs an assignee. */
  epic?: string | null;
}

export interface ListTasksFilters {
  projectId?: string;
  statuses?: readonly TaskStatus[];
  priorities?: readonly TaskPriority[];
  labelIds?: readonly string[];
  activeOnly?: boolean;
  waitingOnly?: boolean;
  parentTaskId?: string | null;
  search?: string;
  sort?: TaskSort;
  limit?: number;
  cursor?: string;
}

export interface SubtaskDoneCounts {
  total: number;
  done: number;
}

export interface CreateLabelInput {
  id?: string;
  projectId: string;
  name: string;
  color: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

export interface CreateCommentInput {
  id?: string;
  taskId: string;
  kind: CommentKind;
  authorName: string;
  presetName?: string | null;
  threadId?: string | null;
  body: string;
  notifiedCount?: number;
}

export interface UpdateCommentInput {
  body?: string;
  notifiedCount?: number;
}

export interface CreateAttachmentInput {
  id?: string;
  taskId?: string | null;
  commentId?: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  blobPath: string;
  isImage: boolean;
}

export interface UpdateAttachmentInput {
  fileName?: string;
  mime?: string;
  sizeBytes?: number;
  blobPath?: string;
  isImage?: boolean;
}

export interface UpsertTaskThreadInput {
  id?: string;
  taskId: string;
  threadId: string;
  presetName: string;
  title: string;
}

export interface CreatePresetInput {
  id?: string;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: PresetPermissionMode;
  environmentKind: PresetEnvironmentKind;
  baseBranch: string | null;
  machineId: string | null;
  instructions: string;
  builtin?: boolean;
}

export interface UpdatePresetInput {
  name?: string;
  providerId?: string;
  modelId?: string;
  reasoningLevel?: string;
  permissionMode?: PresetPermissionMode;
  environmentKind?: PresetEnvironmentKind;
  baseBranch?: string | null;
  machineId?: string | null;
  instructions?: string;
  builtin?: boolean;
}

export interface SavedView {
  id: string;
  scope: string;
  name: string;
  config: FieldDisplayConfig;
  createdAt: string;
}

export interface CreateSavedViewInput {
  id?: string;
  scope: string;
  name: string;
  config: FieldDisplayConfig;
}
