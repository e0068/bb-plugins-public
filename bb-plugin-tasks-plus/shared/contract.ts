import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  TASK_SORTS,
  TASKS_PAGE_DEFAULT_LIMIT,
  TASKS_PAGE_MAX_LIMIT,
} from "./pagination.js";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_TYPES,
  TASK_ESTIMATES,
  TASK_CHECKS,
  PRESET_ENVIRONMENT_KINDS,
  PRESET_PERMISSION_MODES,
  ROW_FIELDS,
  CALLER_THREAD_FIELD,
} from "./enums.js";

// Enums and derived types live in enums.js (no @get-bb/plugin-sdk import),
// so the frontend bundle doesn't pull in the server SDK. The re-export keeps
// the old path working for server code: import { TASK_STATUSES, ... } from "../shared/contract".
export * from "./enums.js";

export const TASK_THREAD_LIVE_STATUSES = [
  "starting",
  "working",
  "idle",
  "completed",
  "failed",
] as const;

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const PROJECT_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const idSchema = z.string().regex(ULID_PATTERN, "must be a ULID");
/** Task.id is `<boardId>:<slug>` (see filesync/assemble.ts) — a stable,
 *  file-derived identity, not a ULID. */
const taskIdSchema = z.string().min(1, "must not be blank");
/** Label.id IS the label's name (see filesync/store.ts's boardLabels) —
 *  there is no separate label entity to generate a ULID for. */
const labelIdSchema = z.string().min(1, "must not be blank");
const nonBlankStringSchema = z.string().trim().min(1, "must not be blank");
/** An assignee or epic as a caller names it; the store checks it can be a
 *  folder. Output carries the folder name verbatim — trimming it would offer
 *  a value no folder has. */
const placementNameSchema = nonBlankStringSchema;
const placementFolderSchema = z.string();
const presetReasoningLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export const presetPermissionModeSchema = z.enum(PRESET_PERMISSION_MODES);
export type PresetPermissionMode = z.infer<typeof presetPermissionModeSchema>;
const presetEnvironmentKindSchema = z.enum(PRESET_ENVIRONMENT_KINDS);
const nullablePresetTargetSchema = nonBlankStringSchema.nullable();
const projectPrefixSchema = z
  .string()
  .regex(
    PROJECT_PREFIX_PATTERN,
    "must be uppercase alphanumeric, start with a letter, and contain at most 10 characters",
  );
const dueDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "must be a valid calendar date in YYYY-MM-DD format");
const taskStatusSchema = z.enum(TASK_STATUSES);
const taskPrioritySchema = z.enum(TASK_PRIORITIES);
const taskTypeSchema = z.enum(TASK_TYPES);
const taskEstimateSchema = z.enum(TASK_ESTIMATES);
const taskCheckSchema = z.enum(TASK_CHECKS);
const rowFieldSchema = z.enum(ROW_FIELDS);
const minutesSchema = z.number().int().min(0);
const dollarsSchema = z.number().finite().min(0);
const taskSortSchema = z.enum(TASK_SORTS);

// Analytics aggregates (BBPL-258). Counts are partial records over each enum —
// the handler fills every key, but a record keeps the contract terse against
// six statuses / five priorities / seven type buckets. "untyped" is the bucket
// for tasks whose type is null.
const analyticsTypeKeySchema = z.union([taskTypeSchema, z.literal("untyped")]);
const nonNegIntSchema = z.number().int().nonnegative();
const tasksSnapshotSchema = z
  .object({
    total: nonNegIntSchema,
    byStatus: z.record(taskStatusSchema, nonNegIntSchema),
    byPriority: z.record(taskPrioritySchema, nonNegIntSchema),
    byType: z.record(analyticsTypeKeySchema, nonNegIntSchema),
    plannedMinutes: nonNegIntSchema,
    actualMinutes: nonNegIntSchema,
    budget: dollarsSchema,
    budgetLimit: dollarsSchema,
    cost: dollarsSchema,
  })
  .strict();
const statusSeriesSchema = z
  .object({
    bins: z.array(z.number()),
    total: z.array(nonNegIntSchema),
    byToStatus: z.record(taskStatusSchema, z.array(nonNegIntSchema)),
  })
  .strict();
const threadSearchStatusSchema = z.enum([
  "idle",
  "starting",
  "active",
  "stopping",
  "error",
]);

export const folderSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    parentFolderId: idSchema.nullable(),
    createdAt: z.string(),
  })
  .strict();

export const projectSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    prefix: projectPrefixSchema,
    nextTaskNumber: z.number().int().positive(),
    color: z.string(),
    folderId: idSchema.nullable(),
    linkedBbProjectId: z.string().startsWith("proj_").nullable(),
    tasksFolder: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

/**
 * Where a task's backing markdown file was last read from. "worktree" means
 * its content there diverges from the linked project's main checkout (or
 * main has no copy at all) — see the server's filesync/fs-boards.ts for the rule
 * that decides this, and db/types.ts's FileTaskOrigin for the source type.
 */
export const fileTaskOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("main") }).strict(),
  z
    .object({
      kind: z.literal("worktree"),
      environmentId: z.string(),
      name: z.string().nullable(),
      branchName: z.string().nullable(),
    })
    .strict(),
]);

export const taskSchema = z
  .object({
    id: taskIdSchema,
    projectId: idSchema,
    /** The board's issued number, null for a file that never got a
     *  `key` — see filesync/assemble.ts. */
    number: z.number().int().positive().nullable(),
    /** The board's short label, falling back to the file's slug when
     *  the file carries no `key`. Always addressable. */
    key: z.string(),
    title: z.string(),
    description: z.string(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    type: taskTypeSchema.nullable(),
    estimate: taskEstimateSchema.nullable(),
    plannedMinutes: minutesSchema.nullable(),
    actualMinutes: minutesSchema.nullable(),
    budget: dollarsSchema.nullable(),
    budgetLimit: dollarsSchema.nullable(),
    cost: dollarsSchema.nullable(),
    dueDate: dueDateSchema.nullable(),
    parentTaskId: taskIdSchema.nullable(),
    position: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    labelIds: z.array(labelIdSchema),
    checks: z.array(taskCheckSchema),
    /** The folder above the task's status folder, null at the root. Optional
     *  so a task built without it reads as unassigned. */
    assignee: placementFolderSchema.nullable().optional(),
    /** The folder inside the assignee's, null when there is none. */
    epic: placementFolderSchema.nullable().optional(),
    /** The markdown file backing this task, when it is file-synced. */
    source: z
      .object({ filePath: z.string(), origin: fileTaskOriginSchema })
      .nullable(),
  })
  .strict();

export const labelSchema = z
  .object({
    id: labelIdSchema,
    projectId: idSchema,
    name: z.string(),
    color: z.string(),
  })
  .strict();

export const commentSchema = z
  .object({
    id: idSchema,
    taskId: taskIdSchema,
    kind: z.enum(["user", "agent", "system"]),
    authorName: z.string(),
    presetName: z.string().nullable(),
    threadId: z.string().startsWith("thr_").nullable(),
    body: z.string(),
    notifiedCount: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .strict();

/**
 * Identity of the provider (agent) that authored an agent comment, resolved at
 * read time from the authoring thread's live `providerId`. `name` and
 * `logoUrl` come from the host provider list; `logoUrl` is populated only for
 * providers that serve a logo asset (custom ACP agents) — built-in providers
 * carry a null `logoUrl` and the UI renders a bundled brand glyph keyed by
 * `id`. `name` falls back to the raw provider id when the provider is no longer
 * installed. See `commentProviderSchema` usages in `displayCommentSchema`.
 */
export const commentProviderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
  })
  .strict();

/**
 * A comment enriched for display with (a) the current human title of the agent
 * thread that authored it and (b) the authoring provider. Both are resolved at
 * read time against the live thread. `threadTitle` is null for user/system
 * comments, legacy agent comments that carry no `threadId`, and threads that
 * are deleted, hidden, side chats, or otherwise inaccessible — callers fall
 * back to `authorName` and render no link. `provider` is null for user/system
 * comments, legacy agent comments with no `threadId`, and threads that are
 * deleted/hidden/inaccessible; it is present (and drives the comment's logo)
 * whenever the authoring thread resolves, including side chats.
 */
export const displayCommentSchema = commentSchema
  .extend({
    threadTitle: z.string().nullable(),
    provider: commentProviderSchema.nullable(),
  })
  .strict();

/** Who an attachment hangs off: a task or one of its comments. */
export const attachmentOwnerSchema = z.union([
  z.object({ taskId: taskIdSchema }).strict(),
  z.object({ commentId: idSchema }).strict(),
]);
export type AttachmentOwnerRef = z.infer<typeof attachmentOwnerSchema>;

export const attachmentSchema = z
  .object({
    id: idSchema,
    taskId: taskIdSchema.nullable(),
    commentId: idSchema.nullable(),
    fileName: z.string(),
    mime: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    isImage: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

export const taskThreadSchema = z
  .object({
    id: idSchema,
    taskId: taskIdSchema,
    threadId: z.string().startsWith("thr_"),
    presetName: z.string(),
    title: z.string(),
    liveStatus: z.enum(TASK_THREAD_LIVE_STATUSES),
    archivedAt: z.string().nullable(),
    attachedAt: z.string(),
  })
  .strict();

/**
 * A GitHub pull request associated with a task through an attached thread's
 * environment (the branch the delegated agent pushed). Assembled server-side
 * from environment pull-request metadata — never scraped from comments.
 * `state` matches the server's product-facing PR state, which already folds
 * GitHub's isDraft flag into a single enum.
 */
export const taskPullRequestSchema = z
  .object({
    url: z.string().url(),
    number: z.number().int().positive(),
    title: z.string(),
    state: z.enum(["open", "draft", "merged", "closed"]),
    updatedAt: z.string(),
    /** Task threads whose environment resolved to this pull request. */
    threadIds: z.array(z.string().startsWith("thr_")).min(1),
  })
  .strict();

export const presetSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    reasoningLevel: z.string(),
    permissionMode: presetPermissionModeSchema,
    environmentKind: presetEnvironmentKindSchema,
    baseBranch: nullablePresetTargetSchema,
    machineId: nullablePresetTargetSchema,
    instructions: z.string(),
    builtin: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

/**
 * Display menu configuration, persisted as a named view. The field list is
 * a subset of ROW_FIELDS with no duplicates: a view saved by an older client
 * doesn't know about a field added later, and the client fills in the list
 * when applying it.
 */
export const fieldDisplayConfigSchema = z
  .object({
    /** Every canonical field exactly once, in display order. */
    fields: z.array(
      z.object({ field: rowFieldSchema, visible: z.boolean() }).strict(),
    ),
    /** Enabled but empty fields render a placeholder instead of collapsing. */
    showEmpty: z.boolean(),
    /** Board only: show the task's leading description lines on its card. */
    showDescription: z.boolean(),
  })
  .strict()
  .refine(
    (config) =>
      new Set(config.fields.map((entry) => entry.field)).size ===
      config.fields.length,
    { message: "fields must not repeat" },
  );

// The view's scope is a partition key that is opaque to the server
// ("all", "active", "project:<id>", "board:<id>", etc.). Its grammar is
// defined and interpreted only by the client; the server doesn't parse it,
// so the layers stay decoupled — otherwise the next client-side view change
// would require a server-side validation change too.
const savedViewScopeSchema = nonBlankStringSchema.max(120);

export const savedViewSchema = z
  .object({
    id: idSchema,
    scope: savedViewScopeSchema,
    name: z.string(),
    config: fieldDisplayConfigSchema,
    createdAt: z.string(),
  })
  .strict();

export const tasksDomainErrorSchema = z
  .object({
    code: z.enum([
      "task_parent_invalid",
      "subtask_depth_exceeded",
      "subtask_project_mismatch",
      "label_project_mismatch",
      "project_not_empty",
      "project_prefix_conflict",
      "attachment_referenced",
    ]),
    message: z.string(),
  })
  .strict();

const taskMutationResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), task: taskSchema }).strict(),
  z.object({ ok: z.literal(false), error: tasksDomainErrorSchema }).strict(),
]);

const projectMutationResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), project: projectSchema }).strict(),
  z.object({ ok: z.literal(false), error: tasksDomainErrorSchema }).strict(),
]);

const projectDeleteResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), deleted: z.boolean() }).strict(),
  z.object({ ok: z.literal(false), error: tasksDomainErrorSchema }).strict(),
]);

const attachmentDeleteResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      deleted: z.literal(true),
      attachment: attachmentSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      deleted: z.literal(false),
      attachment: z.null(),
    })
    .strict(),
  z.object({ ok: z.literal(false), error: tasksDomainErrorSchema }).strict(),
]);

const taskLabelsSchema = z
  .array(labelIdSchema)
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "must not contain duplicates",
  );

const taskChecksSchema = z
  .array(taskCheckSchema)
  .refine(
    (checks) => new Set(checks).size === checks.length,
    "must not contain duplicates",
  );

const updateTaskInputSchema = z
  .object({
    taskId: taskIdSchema,
    /** New file name — the task's id changes with it (see Task.id). */
    slug: nonBlankStringSchema.optional(),
    /** The board's label to set, or null to take it off the file. */
    key: nonBlankStringSchema.nullable().optional(),
    title: nonBlankStringSchema.optional(),
    description: z.string().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    type: taskTypeSchema.nullable().optional(),
    estimate: taskEstimateSchema.nullable().optional(),
    plannedMinutes: minutesSchema.nullable().optional(),
    actualMinutes: minutesSchema.nullable().optional(),
    budget: dollarsSchema.nullable().optional(),
    budgetLimit: dollarsSchema.nullable().optional(),
    cost: dollarsSchema.nullable().optional(),
    dueDate: dueDateSchema.nullable().optional(),
    parentTaskId: taskIdSchema.nullable().optional(),
    labelIds: taskLabelsSchema.optional(),
    checks: taskChecksSchema.optional(),
    assignee: placementNameSchema.nullable().optional(),
    epic: placementNameSchema.nullable().optional(),
    authorName: nonBlankStringSchema.default("You"),
  })
  .strict()
  .refine(
    (input) =>
      input.slug !== undefined ||
      input.key !== undefined ||
      input.title !== undefined ||
      input.description !== undefined ||
      input.status !== undefined ||
      input.priority !== undefined ||
      input.type !== undefined ||
      input.estimate !== undefined ||
      input.plannedMinutes !== undefined ||
      input.actualMinutes !== undefined ||
      input.budget !== undefined ||
      input.budgetLimit !== undefined ||
      input.cost !== undefined ||
      input.dueDate !== undefined ||
      input.parentTaskId !== undefined ||
      input.labelIds !== undefined ||
      input.checks !== undefined ||
      input.assignee !== undefined ||
      input.epic !== undefined,
    { message: "at least one task field must be updated" },
  );

const updateProjectInputSchema = z
  .object({
    projectId: idSchema,
    name: nonBlankStringSchema.optional(),
    color: nonBlankStringSchema.optional(),
    folderId: idSchema.nullable().optional(),
    linkedBbProjectId: z.string().startsWith("proj_").nullable().optional(),
    tasksFolder: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.color !== undefined ||
      input.folderId !== undefined ||
      input.linkedBbProjectId !== undefined ||
      input.tasksFolder !== undefined,
    { message: "at least one project field must be updated" },
  );

const updateLabelInputSchema = z
  .object({
    labelId: labelIdSchema,
    name: nonBlankStringSchema.optional(),
    color: nonBlankStringSchema.optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.color !== undefined, {
    message: "at least one label field must be updated",
  });

const updatePresetInputSchema = z
  .object({
    presetId: idSchema,
    name: nonBlankStringSchema.optional(),
    providerId: nonBlankStringSchema.optional(),
    modelId: nonBlankStringSchema.optional(),
    reasoningLevel: presetReasoningLevelSchema.optional(),
    permissionMode: presetPermissionModeSchema.optional(),
    environmentKind: presetEnvironmentKindSchema.optional(),
    baseBranch: nullablePresetTargetSchema.optional(),
    machineId: nullablePresetTargetSchema.optional(),
    instructions: z.string().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.providerId !== undefined ||
      input.modelId !== undefined ||
      input.reasoningLevel !== undefined ||
      input.permissionMode !== undefined ||
      input.environmentKind !== undefined ||
      input.baseBranch !== undefined ||
      input.machineId !== undefined ||
      input.instructions !== undefined,
    { message: "at least one preset field must be updated" },
  )
  .superRefine((input, ctx) => {
    if (
      input.environmentKind === "project-default" &&
      input.baseBranch !== undefined &&
      input.baseBranch !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseBranch"],
        message: "requires environmentKind new-worktree",
      });
    }
    if (
      input.environmentKind === "project-default" &&
      input.machineId !== undefined &&
      input.machineId !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["machineId"],
        message: "requires environmentKind new-worktree",
      });
    }
  });

/**
 * Тред, из которого пришёл запрос, — служебное поле входа. Обработчик RPC по
 * контракту SDK получает только вход метода, поэтому другого места для него
 * нет; `.strict()` отверг бы поле, которого в схеме не объявлено. Пустое
 * значение означает «спрашивает доска» — и тогда запрос читает main.
 */
export function withCallerThread<Schema extends z.ZodObject>(schema: Schema) {
  return schema.extend({ [CALLER_THREAD_FIELD]: z.string().optional() });
}


/**
 * Владелец вложений — объединение двух форм, а расширять надо каждую: у
 * объединения нет собственной формы, к которой можно добавить поле.
 */
const attachmentOwnerWithCallerSchema = z.union([
  withCallerThread(z.object({ taskId: taskIdSchema }).strict()),
  withCallerThread(z.object({ commentId: idSchema }).strict()),
]);

export const tasksRpcContract = defineRpcContract({
  createFolder: {
    input: z
      .object({
        name: nonBlankStringSchema,
        parentFolderId: idSchema.nullable().default(null),
      })
      .strict(),
    output: z.object({ folder: folderSchema }).strict(),
  },
  renameFolder: {
    input: z
      .object({ folderId: idSchema, name: nonBlankStringSchema })
      .strict(),
    output: z.object({ folder: folderSchema }).strict(),
  },
  moveFolder: {
    input: z
      .object({ folderId: idSchema, parentFolderId: idSchema.nullable() })
      .strict(),
    output: z.object({ folder: folderSchema }).strict(),
  },
  deleteFolder: {
    input: z.object({ folderId: idSchema }).strict(),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  listFolders: {
    input: z.null(),
    output: z.object({ folders: z.array(folderSchema) }).strict(),
  },
  createProject: {
    input: z
      .object({
        name: nonBlankStringSchema,
        prefix: projectPrefixSchema,
        color: nonBlankStringSchema,
        folderId: idSchema.nullable().default(null),
        linkedBbProjectId: z
          .string()
          .startsWith("proj_")
          .nullable()
          .default(null),
      })
      .strict(),
    output: z.object({ project: projectSchema }).strict(),
  },
  updateProject: {
    input: updateProjectInputSchema,
    output: z.object({ project: projectSchema }).strict(),
  },
  renameProjectPrefix: {
    input: z
      .object({ projectId: idSchema, prefix: projectPrefixSchema })
      .strict(),
    output: projectMutationResultSchema,
  },
  deleteProject: {
    input: z
      .object({ projectId: idSchema, force: z.boolean().default(false) })
      .strict(),
    output: projectDeleteResultSchema,
  },
  listProjects: {
    input: z.object({ folderId: idSchema.nullable().optional() }).strict(),
    output: z.object({ projects: z.array(projectSchema) }).strict(),
  },
  createTask: {
    input: withCallerThread(z
      .object({
        projectId: idSchema,
        title: nonBlankStringSchema,
        description: z.string().default(""),
        status: taskStatusSchema.default("backlog"),
        priority: taskPrioritySchema.default("none"),
        type: taskTypeSchema.nullable().default(null),
        estimate: taskEstimateSchema.nullable().default(null),
        plannedMinutes: minutesSchema.nullable().default(null),
        actualMinutes: minutesSchema.nullable().default(null),
        budget: dollarsSchema.nullable().default(null),
        budgetLimit: dollarsSchema.nullable().default(null),
        cost: dollarsSchema.nullable().default(null),
        dueDate: dueDateSchema.nullable().default(null),
        parentTaskId: taskIdSchema.nullable().default(null),
        labelIds: taskLabelsSchema.default([]),
        checks: taskChecksSchema.default([]),
        assignee: placementNameSchema.nullable().default(null),
        epic: placementNameSchema.nullable().default(null),
      })
      .strict()),
    output: taskMutationResultSchema,
  },
  getTask: {
    input: withCallerThread(z.object({ taskId: taskIdSchema }).strict()),
    output: z.object({ task: taskSchema.nullable() }).strict(),
  },
  /**
   * Resolve a task key like "TSK-4" with one targeted query. The prefix is
   * matched case-insensitively; a malformed key resolves to null rather than
   * erroring so stale chat references degrade to the card's not-found state.
   */
  getTaskByKey: {
    input: withCallerThread(z.object({ taskKey: nonBlankStringSchema }).strict()),
    output: z.object({ task: taskSchema.nullable() }).strict(),
  },
  updateTask: {
    input: withCallerThread(updateTaskInputSchema),
    output: taskMutationResultSchema,
  },
  deleteTask: {
    input: withCallerThread(z.object({ taskId: taskIdSchema }).strict()),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  /**
   * Reveal a file-synced task's source markdown in the Finder of the machine
   * running bb's server (`open -R`), selecting it there. Avoids opening the
   * file's content in-browser, which core's preview URL serves without a
   * charset and mangles Cyrillic. macOS-only and local-source-only; `error`
   * explains any other outcome.
   */
  revealTaskSource: {
    input: withCallerThread(z.object({ taskId: taskIdSchema }).strict()),
    output: z
      .object({ revealed: z.boolean(), error: z.string().nullable() })
      .strict(),
  },
  /**
   * Stable keyset page in the requested database sort. `nextCursor` is opaque
   * and bound to the filters, sort, and task-list revision; any list-affecting
   * mutation makes it stale so callers restart instead of mixing snapshots.
   */
  listTasks: {
    input: withCallerThread(z
      .object({
        projectId: idSchema.optional(),
        statuses: z.array(taskStatusSchema).optional(),
        priorities: z.array(taskPrioritySchema).optional(),
        labelIds: z.array(labelIdSchema).optional(),
        activeOnly: z.boolean().default(false),
        waitingOnly: z.boolean().default(false),
        parentTaskId: taskIdSchema.nullable().optional(),
        search: z.string().optional(),
        sort: taskSortSchema.default("manual"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(TASKS_PAGE_MAX_LIMIT)
          .default(TASKS_PAGE_DEFAULT_LIMIT),
        cursor: nonBlankStringSchema.optional(),
      })
      .strict()),
    output: z
      .object({
        tasks: z.array(taskSchema),
        nextCursor: z.string().nullable(),
      })
      .strict(),
  },
  boardMove: {
    input: withCallerThread(z
      .object({
        taskId: taskIdSchema,
        status: taskStatusSchema,
        beforeTaskId: taskIdSchema.nullable().optional(),
        afterTaskId: taskIdSchema.nullable().optional(),
        authorName: nonBlankStringSchema.default("You"),
      })
      .strict()),
    output: taskMutationResultSchema,
  },
  createLabel: {
    input: z
      .object({
        projectId: idSchema,
        name: nonBlankStringSchema,
        color: nonBlankStringSchema,
      })
      .strict(),
    output: z.object({ label: labelSchema }).strict(),
  },
  updateLabel: {
    input: updateLabelInputSchema,
    output: z.object({ label: labelSchema }).strict(),
  },
  deleteLabel: {
    input: withCallerThread(z.object({ labelId: labelIdSchema }).strict()),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  /** Assignees and epics already in use on the board — the folders its
   *  tasks sit in. A new value needs no call: it is created by assigning it. */
  listPlacements: {
    input: withCallerThread(z.object({ projectId: idSchema }).strict()),
    output: z
      .object({
        assignees: z.array(placementFolderSchema),
        epics: z.array(
          z.object({ assignee: placementFolderSchema, name: placementFolderSchema }).strict(),
        ),
      })
      .strict(),
  },
  listLabels: {
    input: z.object({ projectId: idSchema }).strict(),
    output: z.object({ labels: z.array(labelSchema) }).strict(),
  },
  createComment: {
    input: withCallerThread(z
      .object({
        taskId: taskIdSchema,
        body: z.string(),
        notify: z.boolean(),
        // Attachment-only comments opt in explicitly so existing text-only
        // callers retain the non-empty body invariant.
        allowEmptyBody: z.boolean().default(false),
      })
      .strict()
      .refine((input) => input.allowEmptyBody || input.body.trim().length > 0, {
        path: ["body"],
        message: "Comment body cannot be empty",
      })),
    output: z.object({ comment: commentSchema }).strict(),
  },
  listComments: {
    input: withCallerThread(z.object({ taskId: taskIdSchema }).strict()),
    output: z.object({ comments: z.array(displayCommentSchema) }).strict(),
  },
  listAttachments: {
    input: attachmentOwnerWithCallerSchema,
    output: z.object({ attachments: z.array(attachmentSchema) }).strict(),
  },
  deleteAttachment: {
    input: withCallerThread(z
      .object({
        attachmentId: idSchema,
        removeDescriptionReferences: z.boolean().default(false),
      })
      .strict()),
    output: attachmentDeleteResultSchema,
  },
  listTaskThreads: {
    input: withCallerThread(z.object({ taskId: taskIdSchema }).strict()),
    output: z.object({ taskThreads: z.array(taskThreadSchema) }).strict(),
  },
  // Reverse of listTaskThreads: the tasks a single thread is attached to,
  // in attach order. Backs the thread-header chip and `bb tasks current`.
  tasksForThread: {
    input: withCallerThread(z.object({ threadId: z.string().startsWith("thr_") }).strict()),
    output: z.object({ tasks: z.array(taskSchema) }).strict(),
  },
  // Pull requests reached through the task's attached threads, deduplicated
  // by URL. Threads whose PR lookup failed (deleted thread, gh missing or
  // unauthenticated, unreachable workspace) are reported in
  // `unavailableThreadIds` rather than failing the whole call — distinct from
  // threads with no environment or a genuinely absent PR, which produce
  // nothing.
  listTaskPullRequests: {
    input: withCallerThread(z.object({ taskId: taskIdSchema }).strict()),
    output: z
      .object({
        pullRequests: z.array(taskPullRequestSchema),
        unavailableThreadIds: z.array(z.string().startsWith("thr_")),
      })
      .strict(),
  },
  createPreset: {
    input: z
      .object({
        name: nonBlankStringSchema,
        providerId: nonBlankStringSchema,
        modelId: nonBlankStringSchema,
        reasoningLevel: presetReasoningLevelSchema,
        permissionMode: presetPermissionModeSchema,
        environmentKind: presetEnvironmentKindSchema.default("project-default"),
        baseBranch: nullablePresetTargetSchema.default(null),
        machineId: nullablePresetTargetSchema.default(null),
        instructions: z.string().default(""),
      })
      .strict()
      .superRefine((input, ctx) => {
        if (
          input.environmentKind === "project-default" &&
          input.baseBranch !== null
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["baseBranch"],
            message: "requires environmentKind new-worktree",
          });
        }
        if (
          input.environmentKind === "project-default" &&
          input.machineId !== null
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["machineId"],
            message: "requires environmentKind new-worktree",
          });
        }
      }),
    output: z.object({ preset: presetSchema }).strict(),
  },
  updatePreset: {
    input: updatePresetInputSchema,
    output: z.object({ preset: presetSchema }).strict(),
  },
  deletePreset: {
    input: z.object({ presetId: idSchema }).strict(),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  listPresets: {
    input: z.null(),
    output: z.object({ presets: z.array(presetSchema) }).strict(),
  },
  listSavedViews: {
    input: z.object({ scope: savedViewScopeSchema }).strict(),
    output: z.object({ savedViews: z.array(savedViewSchema) }).strict(),
  },
  /**
   * Name is unique within scope case-insensitively; saving under a name
   * already taken in that scope overwrites the existing view's config while
   * keeping its id and createdAt. See
   * memory/decisions/saved-view-name-overwrite.md.
   */
  createSavedView: {
    input: z
      .object({
        scope: savedViewScopeSchema,
        name: nonBlankStringSchema.max(60),
        config: fieldDisplayConfigSchema,
      })
      .strict(),
    output: z.object({ savedView: savedViewSchema }).strict(),
  },
  deleteSavedView: {
    input: z.object({ savedViewId: idSchema }).strict(),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  listProviders: {
    input: z.object({}).strict(),
    output: z
      .object({
        providers: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              permissionModes: z.array(presetPermissionModeSchema),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  listProviderModels: {
    input: z.object({ providerId: nonBlankStringSchema }).strict(),
    output: z
      .object({
        models: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              isDefault: z.boolean(),
            })
            .strict(),
        ),
        reasoningLevels: z.array(z.string()),
      })
      .strict(),
  },
  listMachines: {
    input: z.object({}).strict(),
    output: z
      .object({
        machines: z.array(
          z.object({ id: z.string(), name: z.string() }).strict(),
        ),
      })
      .strict(),
  },
  searchThreads: {
    input: z
      .object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
      })
      .strict(),
    output: z
      .object({
        threads: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              status: threadSearchStatusSchema,
            })
            .strict(),
        ),
      })
      .strict(),
  },
  // BB workspace projects (proj_…) for the linked-project picker; distinct
  // from this plugin's own task projects.
  listBbProjects: {
    input: z.null(),
    output: z
      .object({
        bbProjects: z.array(
          z
            .object({ id: z.string().startsWith("proj_"), name: z.string() })
            .strict(),
        ),
      })
      .strict(),
  },
  sidebarOpenTaskCount: {
    input: z.null(),
    output: z
      .object({ openTaskCount: z.number().int().nonnegative() })
      .strict(),
  },
  sidebarSummary: {
    input: z.null(),
    output: z
      .object({
        projects: z.array(
          z
            .object({
              projectId: idSchema,
              taskCount: z.number().int().nonnegative(),
              activeAgentCount: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  analyticsSnapshot: {
    input: z.object({ projectId: idSchema.nullable().optional() }).strict(),
    output: tasksSnapshotSchema,
  },
  analyticsSeries: {
    input: z
      .object({
        fromMs: z.number(),
        toMs: z.number(),
        binMs: z.number().int().positive(),
        projectId: idSchema.nullable().optional(),
      })
      .strict(),
    output: statusSeriesSchema,
  },
});

export type TasksRpcContract = typeof tasksRpcContract;
export type TasksSnapshot = z.infer<typeof tasksSnapshotSchema>;
export type StatusSeries = z.infer<typeof statusSeriesSchema>;
export type Folder = z.infer<typeof folderSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Label = z.infer<typeof labelSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type CommentProvider = z.infer<typeof commentProviderSchema>;
export type DisplayComment = z.infer<typeof displayCommentSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type TaskThread = z.infer<typeof taskThreadSchema>;
export type TaskPullRequest = z.infer<typeof taskPullRequestSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type FieldDisplayConfig = z.infer<typeof fieldDisplayConfigSchema>;
export type SavedView = z.infer<typeof savedViewSchema>;
export type TasksDomainError = z.infer<typeof tasksDomainErrorSchema>;
export type TaskMutationResult = z.infer<typeof taskMutationResultSchema>;
export type ProjectMutationResult = z.infer<typeof projectMutationResultSchema>;
export type BbProjectOption = z.infer<
  (typeof tasksRpcContract)["listBbProjects"]["output"]
>["bbProjects"][number];
export type SidebarProjectSummary = z.infer<
  (typeof tasksRpcContract)["sidebarSummary"]["output"]
>["projects"][number];

export interface TasksChangedEvent {
  /** null when a batch touched several tasks of the project at once (file
   * sync) — subscribers keyed on one task must treat it as "maybe mine". */
  taskId: string | null;
  projectId: string;
}

export interface ProjectsChangedEvent {
  projectId: string | null;
}

export interface CommentsChangedEvent {
  taskId: string;
  notifiedCount?: number;
}

export interface ThreadsChangedEvent {
  taskId: string;
}
