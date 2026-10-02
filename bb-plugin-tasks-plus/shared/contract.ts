import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ReducedColors } from "@bb-plugins/reduced-colors/core/settings";
import {
  TASK_SORTS,
  TASKS_PAGE_DEFAULT_LIMIT,
  TASKS_PAGE_MAX_LIMIT,
  TASK_CARD_META_MAX_IDS,
} from "./pagination.js";
import { isPlanDate } from "./plan-date.js";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_TYPES,
  TASK_ESTIMATES,
  PRESET_ENVIRONMENT_KINDS,
  PRESET_PERMISSION_MODES,
  ROW_FIELDS,
  LIST_SORTS,
  BOARD_GROUP_BYS,
  BOARD_GROUP_PROPERTIES,
  BOARD_COLUMN_WIDTH,
  BOARD_GRID_COLUMN_COUNTS,
  SUBTASK_SCOPES,
  TASK_OPENINGS,
  CALLER_THREAD_FIELD,
  MAX_CARD_CHART_DAYS,
  TABLE_SORT_DIRECTIONS,
  TABLE_COLUMN_WIDTH,
  TASK_LAYOUTS,
  VALUE_FILTER_FIELDS,
  TEXT_FIELDS,
  DATE_FIELDS,
  NUMBER_FIELDS,
  QUERY_FIELDS,
  GANTT_MODES,
} from "./enums.js";
import type { QueryField, TaskLayout } from "./enums.js";
import {
  BAR_LENGTHS,
  FIGURES,
  LEGEND_PLACES,
  TILE_LIMIT,
  TILE_SORT_KEYS,
  TILE_TITLE_MAX,
  TILE_TYPES,
  LEGACY_WINDOWS,
  WINDOW_COUNT_MAX,
  WINDOW_UNITS,
  Y_METRICS,
  CONDITION_OPS,
  CONDITION_VALUE_MAX,
  CONDITIONS_MAX,
  CONTENTS_SHARE,
  TILE_TABLE_FIELDS,
  TILE_TABLE_HEIGHTS,
  TILE_TABLE_ROWS,
  TILE_TABLE_SHOWN_MAX,
  conditionsFromFilters,
} from "./analytics-tile.js";

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
/** Comment.id is whatever the task file's marker carries: the board writes
 *  ULIDs, but agents add comments by hand with ids like `c1`, and one such
 *  comment must not fail the whole Activity list. */
const commentIdSchema = z.string().min(1, "must not be blank");
/** A thread record's id comes from the task file's `threads:` block, which
 *  agents also write by hand; one made-up id must not fail the card chips
 *  of the whole board. */
const threadRecordIdSchema = z.string().min(1, "must not be blank");
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
  .refine(isPlanDate, "must be a valid date in YYYY-MM-DD or YYYY-MM-DDTHH:mm format");
const taskStatusSchema = z.enum(TASK_STATUSES);
const taskPrioritySchema = z.enum(TASK_PRIORITIES);
const taskTypeSchema = z.enum(TASK_TYPES);
const taskEstimateSchema = z.enum(TASK_ESTIMATES);
const rowFieldSchema = z.enum(ROW_FIELDS);
const minutesSchema = z.number().int().min(0);
const dollarsSchema = z.number().finite().min(0);
const taskSortSchema = z.enum(TASK_SORTS);

/** Column edges: one more than the columns, up to the longest period a tile may count (WINDOW_COUNT_MAX). */
const columnEdgesSchema = z.array(z.number().finite()).min(2).max(Math.max(1000, ...Object.values(WINDOW_COUNT_MAX)) + 1);
/** Projects to narrow an analytics call to; absent or empty — every project. */
const projectIdsSchema = z.array(idSchema).max(200).optional();
// The Gantt charts (analytics/gantt.ts): per task, the stretches it stood in
// each status since the chart opens, and its planned dates as calendar days —
// the client places those on the viewer's own calendar.
const ganttAnswerSchema = z
  .object({
    rows: z.array(
      z
        .object({
          taskId: z.string(),
          key: z.string(),
          title: z.string(),
          projectId: z.string(),
          parentTaskId: z.string().nullable(),
          status: taskStatusSchema,
          /** When the task was made; null when its date does not read. */
          createdMs: z.number().nullable(),
          startDate: dueDateSchema.nullable(),
          dueDate: dueDateSchema.nullable(),
          segments: z.array(z.object({ status: taskStatusSchema, fromMs: z.number(), toMs: z.number() }).strict()),
        })
        .strict(),
    ),
    projects: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  })
  .strict();
const threadSearchStatusSchema = z.enum([
  "pending",
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
    /** The online database the board lives in, null or absent for a board
     *  that lives in files. */
    database: z.object({ url: z.string() }).strict().nullable().optional(),
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
  z.object({ kind: z.literal("database"), url: z.string() }).strict(),
]);

/** Who took a task: the machine's name, the thread it took it in (null when
 *  taken without one) and when — see shared/task-claim.ts. */
export const takenBySchema = z
  .object({ machine: z.string().min(1), threadId: z.string().nullable(), at: z.string() })
  .strict();

/** A flow of the Flow plugin as the task file names it: its id for the
 *  link to its page, and the name it had when the run stamped it. */
const taskFlowSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict();

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
    /** Planned start of the work, the mirror of `dueDate` — and nullable like
     *  it, not optional: two fields that mean the same kind of thing must not
     *  need two different emptiness checks at every reader. */
    startDate: dueDateSchema.nullable(),
    parentTaskId: taskIdSchema.nullable(),
    /** The nearest ancestor typed epic (shared/epic.ts), worked out when the
     *  board is read and never written. Optional so a task built without it
     *  reads as outside any epic. */
    epicId: taskIdSchema.nullable().optional(),
    position: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    labelIds: z.array(labelIdSchema),
    /** The flow the task's run went through, stamped into the file by the
     *  Flow plugin; null or absent — no run has named one. Optional like
     *  `assignee`, so a task built without it reads as flow-less. */
    flow: taskFlowSchema.nullable().optional(),
    /** Who took the task, null or absent when nobody did. */
    takenBy: takenBySchema.nullable().optional(),
    /** The folder above the task's status folder, null at the root. Optional
     *  so a task built without it reads as unassigned. */
    assignee: placementFolderSchema.nullable().optional(),
    /** The legacy epic folder inside the assignee's, null when there is none.
     *  Read-only: it tells the store where the file lies until
     *  `bb tasks epics migrate` moves it out; the epic itself is `epicId`. */
    epic: placementFolderSchema.nullable().optional(),
    /** The markdown file backing this task, when it is file-synced. */
    source: z
      .object({
        filePath: z.string(),
        origin: fileTaskOriginSchema,
        /** The row version of a database board's task at the moment it was read. */
        revision: z.number().int().nullable().optional(),
      })
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
    id: commentIdSchema,
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
  z.object({ commentId: commentIdSchema }).strict(),
]);
export type AttachmentOwnerRef = z.infer<typeof attachmentOwnerSchema>;

export const attachmentSchema = z
  .object({
    id: idSchema,
    taskId: taskIdSchema.nullable(),
    commentId: commentIdSchema.nullable(),
    fileName: z.string(),
    mime: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    isImage: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

export const taskThreadSchema = z
  .object({
    id: threadRecordIdSchema,
    taskId: taskIdSchema,
    threadId: z.string().startsWith("thr_"),
    presetName: z.string(),
    title: z.string(),
    liveStatus: z.enum(TASK_THREAD_LIVE_STATUSES),
    archivedAt: z.string().nullable(),
    attachedAt: z.string(),
  })
  .strict();

/** A task's card chips — attachment count and threads (taskCardMeta). */
export const taskCardMetaSchema = z
  .object({
    taskId: taskIdSchema,
    attachmentCount: z.number().int().nonnegative(),
    taskThreads: z.array(taskThreadSchema),
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
    /**
     * Whether the description shows — the board card's first paragraph or
     * the table's column. Mirrors the `description` field's visibility, so a
     * board view saved before Description was a field still opens with it on
     * or off as it was.
     */
    showDescription: z.boolean(),
    /** Board only: which sub-tasks a card lists; absent is "all", as saved before the choice. */
    subtaskScope: z.enum(SUBTASK_SCOPES).optional(),
    /** Where a click on a task opens it; absent is "main", as saved before the choice. */
    taskOpening: z.enum(TASK_OPENINGS).optional(),
  })
  .strict()
  .refine(
    (config) =>
      new Set(config.fields.map((entry) => entry.field)).size ===
      config.fields.length,
    { message: "fields must not repeat" },
  );

/**
 * The filters a view carries — the list filter bar's state, by name rather
 * than by id: a label or an assignee renamed elsewhere should not silently
 * empty a saved view.
 */
const rangeOf = <T extends z.ZodType>(bound: T) =>
  z.object({ from: bound.nullable(), to: bound.nullable(), empty: z.boolean() }).strict();
const dayRangeSchema = rangeOf(z.string().regex(ISO_DATE_PATTERN));
const numberRangeSchema = rangeOf(z.number().finite());

export const savedViewFiltersSchema = z
  .object({
    statuses: z.array(taskStatusSchema),
    priorities: z.array(taskPrioritySchema),
    types: z.array(taskTypeSchema),
    estimates: z.array(taskEstimateSchema),
    labelNames: z.array(z.string()),
    assignees: z.array(z.string()),
    /** Ids of tasks: a task passes when it lies under one of them. */
    parents: z.array(z.string()),
    /**
     * The filters on every other field (shared/task-fields.ts). Each is a
     * partial record — only the fields filtered on — and optional: absent
     * from a view saved before they existed, or filtering nothing, a view
     * reads back exactly as it was written.
     */
    values: z.partialRecord(z.enum(VALUE_FILTER_FIELDS), z.array(z.string())).optional(),
    texts: z.partialRecord(z.enum(TEXT_FIELDS), z.string()).optional(),
    dates: z.partialRecord(z.enum(DATE_FIELDS), dayRangeSchema).optional(),
    numbers: z.partialRecord(z.enum(NUMBER_FIELDS), numberRangeSchema).optional(),
  })
  .strict();

/* ---------- analytics tiles (shared/analytics-tile.ts) ---------- */

const queryFieldSchema = z.enum(QUERY_FIELDS as unknown as [QueryField, ...QueryField[]]);

const tileTableFieldSchema = z.enum(TILE_TABLE_FIELDS as unknown as [QueryField, ...QueryField[]]);

/** The table under a tile's chart (shared/analytics-tile.ts): the title always shown, no column twice. */
const tileTableSchema = z
  .object({
    columns: z
      .array(tileTableFieldSchema)
      .refine((columns) => columns.includes("title"), "The title is always shown")
      .refine((columns) => new Set(columns).size === columns.length, "A column is shown once"),
    sort: z.object({ column: tileTableFieldSchema, direction: z.enum(TABLE_SORT_DIRECTIONS) }).strict().nullable(),
    rows: z.number().int().min(TILE_TABLE_ROWS.min).max(TILE_TABLE_ROWS.max),
    rowHeight: z.enum(TILE_TABLE_HEIGHTS),
  })
  .strict();

/** One tile of the analytics screen — docs/specs/analitika-model-plitki-i-agregaciya-po-lyubomu-polyu.md. */
export const tileSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(TILE_TYPES),
    title: z.string().max(TILE_TITLE_MAX),
    /** The header's period, or the last `count` minutes, hours or days. */
    window: z.union([
      z.literal("page"),
      z
        .object({ unit: z.enum(WINDOW_UNITS), count: z.number().int().min(1) })
        .strict()
        .refine((window) => window.count <= WINDOW_COUNT_MAX[window.unit], "Too many columns for the unit"),
    ]),
    x: z.union([z.literal("time"), queryFieldSchema]),
    y: z.object({ metric: z.enum(Y_METRICS), field: z.enum(NUMBER_FIELDS).nullable() }).strict(),
    breakdown: queryFieldSchema.nullable(),
    switch: queryFieldSchema.nullable(),
    /** The tile's filter: rows "field · operator · value" (shared/tile-conditions.ts). */
    conditions: z
      .array(z.object({ field: queryFieldSchema, op: z.enum(CONDITION_OPS), value: z.string().max(CONDITION_VALUE_MAX) }).strict())
      .max(CONDITIONS_MAX),
    sort: z
      .object({ by: z.union([z.enum(TILE_SORT_KEYS), queryFieldSchema]), direction: z.enum(TABLE_SORT_DIRECTIONS) })
      .strict()
      .nullable(),
    limit: z.number().int().min(TILE_LIMIT.min).max(TILE_LIMIT.max),
    bars: z.object({ length: z.enum(BAR_LENGTHS), gantt: z.enum(GANTT_MODES) }).strict(),
    figures: z.array(z.enum(FIGURES)).max(FIGURES.length),
    display: z
      .object({
        legend: z.enum(LEGEND_PLACES),
        xLabels: z.boolean(),
        yLabels: z.boolean(),
        /** A grid line every N columns across, and every `y` units of the value up; null — no lines that way. */
        grid: z.object({ x: z.number().int().min(1).nullable(), y: z.number().positive().nullable() }).strict(),
        trend: z.boolean(),
        /** The chart's share of the height while the tile lists its segments' tasks under it; absent — no list, segments not clickable. */
        contents: z.number().min(CONTENTS_SHARE.min).max(CONTENTS_SHARE.max).optional(),
      })
      .strict(),
    /** The table of the segments' tasks under the chart; absent — a tile saved before it, read with tileTable's start. */
    table: tileTableSchema.optional(),
  })
  .strict();

const dashboardRowSchema = z
  .object({
    id: z.string().min(1),
    height: z.number().finite().positive(),
    minHeight: z.number().finite().positive(),
    cells: z.array(z.object({ id: z.string().min(1), weight: z.number().finite().positive() }).strict()).min(1),
  })
  .strict();

/** The tiles of the analytics screen and the rows they stand in. */
export const dashboardSchema = z
  .object({ version: z.literal(1), tiles: z.array(tileSchema).max(100), rows: z.array(dashboardRowSchema).max(100) })
  .strict();

export type Tile = z.infer<typeof tileSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;

/**
 * A dashboard saved by an older build: a tile's board-style `filters` become
 * its `conditions` (conditionsFromFilters), and a fixed period — last24h,
 * last30d, last8w — the hours or days it meant (LEGACY_WINDOWS); anything
 * else goes on as it came, for the schema to judge.
 */
function upgraded(value: unknown): unknown {
  const stored = z.object({ tiles: z.array(z.unknown()) }).passthrough().safeParse(value);
  if (!stored.success) return value;
  const tiles = stored.data.tiles.map((tile) => {
    const legacy = z.object({ filters: savedViewFiltersSchema }).passthrough().safeParse(tile);
    if (!legacy.success) return tile;
    const { filters, ...rest } = legacy.data;
    return { ...rest, conditions: conditionsFromFilters(filters) };
  }).map((tile) => {
    const fixed = z.object({ window: z.enum(Object.keys(LEGACY_WINDOWS) as [string, ...string[]]) }).passthrough().safeParse(tile);
    return fixed.success ? { ...fixed.data, window: LEGACY_WINDOWS[fixed.data.window] } : tile;
  });
  return { ...stored.data, tiles };
}

/**
 * A stored dashboard, or null when the value is not one. A tile without a
 * cell and a cell without a tile are dropped, and a row left without cells
 * with them, so the tiles and the rows always name each other.
 */
export function parseDashboard(value: unknown): Dashboard | null {
  const parsed = dashboardSchema.safeParse(upgraded(value));
  if (!parsed.success) return null;
  const tileIds = new Set(parsed.data.tiles.map((tile) => tile.id));
  const rows = parsed.data.rows
    .map((row) => ({ ...row, cells: row.cells.filter((cell) => tileIds.has(cell.id)) }))
    .filter((row) => row.cells.length > 0);
  const placed = new Set(rows.flatMap((row) => row.cells.map((cell) => cell.id)));
  return { version: 1, tiles: parsed.data.tiles.filter((tile) => placed.has(tile.id)), rows };
}

const tileRowSchema = z
  .object({
    taskId: z.string(),
    key: z.string(),
    title: z.string(),
    projectId: z.string(),
    parentTaskId: z.string().nullable(),
    status: taskStatusSchema,
    createdMs: z.number().nullable(),
    startDate: dueDateSchema.nullable(),
    dueDate: dueDateSchema.nullable(),
    segments: z.array(z.object({ status: taskStatusSchema, fromMs: z.number(), toMs: z.number() }).strict()),
    /** Since when the task stands in its status. */
    sinceMs: z.number().nullable(),
  })
  .strict();

const keyLabelSchema = z.object({ key: z.string(), label: z.string() }).strict();

/** What a tile draws — analytics/tile.ts. */
export const tileAnswerSchema = z
  .object({
    columns: z.array(keyLabelSchema),
    series: z.array(keyLabelSchema),
    /** values[column][series]. */
    values: z.array(z.array(z.number())),
    /** Keys of the tasks behind each value, cells[column][series]. */
    cells: z.array(z.array(z.array(z.string()))),
    /** Titles of the tasks the cells name, by key. */
    titles: z.record(z.string(), z.string()),
    switchValues: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int() }).strict()),
    /** Tasks the tile's filter keeps. */
    total: z.number(),
    rows: z.array(tileRowSchema),
    figures: z.partialRecord(z.enum(FIGURES), z.number().nullable()),
    projects: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    logStartMs: z.number().nullable(),
  })
  .strict();

export type TileAnswer = z.infer<typeof tileAnswerSchema>;

/** Days a board's card charts look back; 0 is all time (enums.ts). */
const cardChartPeriodSchema = z.number().int().min(0).max(MAX_CARD_CHART_DAYS);

/** The cross-project surface a view opens, when it is not bound to a project. */
const savedViewListScopeSchema = z.enum(["active", "waiting"]).nullable();

/** A sort by one field in one direction — a table's, and a view's since sorts have a direction. */
const columnSortSchema = z
  .object({ column: rowFieldSchema, direction: z.enum(TABLE_SORT_DIRECTIONS) })
  .strict();

/** A view's sort: a field and a direction, or one of the list sorts as views stored it before (shared/task-fields.ts). */
const savedViewSortSchema = z.union([z.enum(LIST_SORTS), columnSortSchema]);

/**
 * How one property lays out its columns on a board: which go first, which
 * are hidden, and how wide each one was dragged. Keys are column keys — the
 * property's value, a label or folder name, or "none" for the empty value.
 */
const boardColumnSettingsSchema = z
  .object({
    order: z.array(z.string()),
    hidden: z.array(z.string()),
    widths: z.record(
      z.string(),
      z.number().int().min(BOARD_COLUMN_WIDTH.min).max(BOARD_COLUMN_WIDTH.max),
    ),
  })
  .strict();

/**
 * A board's grouping. Column settings are kept per property, so switching
 * from Priority to Status and back finds the Priority columns as they were;
 * a partial record, because zod 4's z.record over an enum demands every key.
 */
export const boardGroupingSchema = z
  .object({
    groupBy: z.enum(BOARD_GROUP_BYS),
    columns: z.partialRecord(z.enum(BOARD_GROUP_PROPERTIES), boardColumnSettingsSchema),
    hideEmpty: z.boolean(),
    /** Columns of the ungrouped grid; absent is "auto", as saved before the choice. */
    gridColumns: z.union([z.literal("auto"), z.literal(BOARD_GRID_COLUMN_COUNTS)]).optional(),
  })
  .strict();

/**
 * A table's own settings: its sort, its board-style grouping, its column
 * widths and pinned columns, and which of its groups are collapsed. Kept
 * alongside a saved view rather than folded into `fields` — a display menu
 * concern — because a table's sort and layout are its own, not the field
 * list's.
 */
export const tableSettingsSchema = z
  .object({
    /** The column the table is sorted by, or unsorted (manual order). */
    sort: columnSortSchema.nullable(),
    groupBy: z.enum(BOARD_GROUP_BYS),
    /** Dragged column widths, px; absent columns draw their default. */
    widths: z.partialRecord(
      rowFieldSchema,
      z.number().int().min(TABLE_COLUMN_WIDTH.min).max(TABLE_COLUMN_WIDTH.max),
    ),
    /** Columns pinned to the left, in order. */
    pinned: z.array(rowFieldSchema),
    /** Names of collapsed groups, when the table is grouped. */
    collapsedGroups: z.array(z.string()),
  })
  .strict();
export type TableSettings = z.infer<typeof tableSettingsSchema>;

const savedViewBodySchema = z.object({
  name: nonBlankStringSchema.max(60),
  /** The project the view opens, or null for a cross-project surface. */
  projectId: idSchema.nullable(),
  /** Mutually exclusive with `projectId`: a view opens one list, not two. */
  listScope: savedViewListScopeSchema,
  /** Records written before boards had views name no surface: a table. */
  surface: z
    .enum([...TASK_LAYOUTS, "list"])
    .default("table")
    .transform((value) => (value === "list" ? "table" : value)),
  filters: savedViewFiltersSchema,
  sort: savedViewSortSchema,
  fields: fieldDisplayConfigSchema,
  /** The board's grouping — present exactly when the view opens a board. */
  board: boardGroupingSchema.nullable().default(null),
  /** The table's own settings, or null for a view saved before tables had them. */
  table: tableSettingsSchema.nullable().default(null),
});

interface SurfaceShape {
  projectId: string | null;
  listScope: string | null;
  surface: TaskLayout;
  board: unknown;
  table: unknown;
}

/**
 * A view opens exactly one surface: a project and a cross-project surface
 * are never both named; a table carries no board grouping, a board always
 * does.
 */
const oneSurface = (view: SurfaceShape) =>
  !(view.projectId !== null && view.listScope !== null) &&
  (view.surface === "board" ? view.board !== null : view.board === null);

const ONE_SURFACE_MESSAGE = {
  message:
    "a view never names a project and a cross-project surface at once; a table view carries no board grouping, a board view always does",
};

export const savedViewSchema = savedViewBodySchema
  .extend({
    id: idSchema,
    /** Bumped when the stored shape changes; see filesync/saved-view-migrate.ts. */
    version: z.literal(2),
    createdAt: z.string(),
  })
  .strict()
  .refine(oneSurface, ONE_SURFACE_MESSAGE);

const createSavedViewInputSchema = savedViewBodySchema
  .strict()
  .refine(oneSurface, ONE_SURFACE_MESSAGE);

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
      "task_already_taken",
      "database_unreachable",
      "database_auth_failed",
      "task_write_conflict",
    ]),
    message: z.string(),
    /** Set with `task_already_taken`: the mark of whoever took the task first. */
    takenBy: takenBySchema.optional(),
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
    startDate: dueDateSchema.nullable().optional(),
    parentTaskId: taskIdSchema.nullable().optional(),
    labelIds: taskLabelsSchema.optional(),
    assignee: placementNameSchema.nullable().optional(),
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
      input.startDate !== undefined ||
      input.parentTaskId !== undefined ||
      input.labelIds !== undefined ||
      input.assignee !== undefined,
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
  withCallerThread(z.object({ commentId: commentIdSchema }).strict()),
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
        startDate: dueDateSchema.nullable().default(null),
        parentTaskId: taskIdSchema.nullable().default(null),
        labelIds: taskLabelsSchema.default([]),
        assignee: placementNameSchema.nullable().default(null),
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
        /** The status the card left on the board that sent the drop; absent — a drop inside its own column. */
        fromStatus: taskStatusSchema.optional(),
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
  /** `bb tasks epics migrate`: every epic folder of the board becomes an epic
   *  task (filesync/epic-migrate.ts); a dry run tells the plan and writes nothing. */
  migrateEpics: {
    input: withCallerThread(z.object({ projectId: idSchema, dryRun: z.boolean().default(false) }).strict()),
    output: z
      .object({
        epics: z.array(
          z
            .object({
              key: z.string().nullable(),
              name: placementFolderSchema,
              assignee: placementFolderSchema,
              tasks: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  /** Assignees already in use on the board — the folders its tasks sit in.
   *  A new value needs no call: it is created by assigning it. */
  listPlacements: {
    input: withCallerThread(z.object({ projectId: idSchema }).strict()),
    output: z
      .object({
        assignees: z.array(placementFolderSchema),
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
  // The board's sub-task burndowns, one call per board: per task with tasks
  // under it, how many of them still owed work at each column end (the last
  // one now), those ends, and the days the trend needs to reach zero. The
  // columns are the period's (analytics/burndown.ts).
  taskBurndowns: {
    input: withCallerThread(z.object({ projectId: idSchema, period: cardChartPeriodSchema }).strict()),
    output: z
      .object({
        burndowns: z.array(
          z
            .object({
              taskId: taskIdSchema,
              open: z.array(z.number().int().nonnegative()),
              ends: z.array(z.number()),
              forecastDays: z.number().int().nonnegative().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  // Bulk card chips for the board and the list: attachment count and threads
  // per task, one board read per board instead of one per task. Unknown ids
  // are left out.
  taskCardMeta: {
    input: withCallerThread(
      z
        .object({ taskIds: z.array(taskIdSchema).max(TASK_CARD_META_MAX_IDS) })
        .strict(),
    ),
    output: z.object({ cards: z.array(taskCardMetaSchema) }).strict(),
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
  /** Every view, of every surface: a view is a navigation entry, not a
   *  setting of the list it was saved from. */
  listSavedViews: {
    input: z.object({}).strict(),
    output: z.object({ savedViews: z.array(savedViewSchema) }).strict(),
  },
  /**
<<<<<<< HEAD
   * Name is unique within scope case-insensitively; saving under a name
   * already taken in that scope overwrites the existing view's config while
   * keeping its id and createdAt. See
   * docs/decisions/saved-view-name-overwrite.md.
=======
   * Name is unique case-insensitively; saving under a name already taken
   * overwrites that view while keeping its id and createdAt. See
   * docs/decisions/saved-view-name-overwrite.md.
>>>>>>> origin/main
   */
  createSavedView: {
    input: createSavedViewInputSchema,
    output: z.object({ savedView: savedViewSchema }).strict(),
  },
  updateSavedView: {
    input: z
      .object({ savedViewId: idSchema, name: nonBlankStringSchema.max(60) })
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

  // When the history of the asked projects starts — where "all time" opens.
  analyticsSpan: {
    input: z.object({ projectIds: projectIdsSchema }).strict(),
    output: z.object({ firstCreatedMs: z.number().nullable() }).strict(),
  },
  ganttRows: {
    input: z.object({ fromMs: z.number().finite(), projectIds: projectIdsSchema }).strict(),
    output: ganttAnswerSchema,
  },
  // One tile of the analytics screen over the client's column edges.
  analyticsTile: {
    input: z
      .object({ tile: tileSchema, edges: columnEdgesSchema, projectIds: projectIdsSchema, picked: z.string().nullable() })
      .strict(),
    output: tileAnswerSchema,
  },
  // The tasks behind a pick on a tile's chart — all of the chart's while none
  // is picked — sorted, the first `limit` of them, and how many in all.
  analyticsTileTasks: {
    input: z
      .object({
        tile: tileSchema,
        edges: columnEdgesSchema,
        projectIds: projectIdsSchema,
        picked: z.string().nullable(),
        pick: z.object({ column: z.number().int().min(0), series: z.string().nullable() }).strict().nullable(),
        sort: z.object({ column: queryFieldSchema, direction: z.enum(TABLE_SORT_DIRECTIONS) }).strict().nullable(),
        limit: z.number().int().min(TILE_TABLE_ROWS.min).max(TILE_TABLE_SHOWN_MAX),
      })
      .strict(),
    output: z.object({ tasks: z.array(taskSchema), total: z.number().int().nonnegative() }).strict(),
  },
  // The tiles of the analytics screen, kept in the plugin's KV; null — none saved yet.
  loadAnalyticsDashboard: {
    input: z.object({}).strict(),
    output: dashboardSchema.nullable(),
  },
  saveAnalyticsDashboard: {
    input: dashboardSchema,
    output: z.object({ ok: z.literal(true) }),
  },
  // Reduced Colors of the analytics screen (packages/reduced-colors). The
  // shape is owned by the package's total parse, which both ends run the
  // value through — the schema only lets it pass.
  loadReducedColors: {
    input: z.object({}).strict(),
    output: z.custom<ReducedColors>(),
  },
  saveReducedColors: {
    input: z.custom<ReducedColors>(),
    output: z.object({ ok: z.literal(true) }),
  },
});

export type TasksRpcContract = typeof tasksRpcContract;
export type GanttAnswer = z.infer<typeof ganttAnswerSchema>;
export type Folder = z.infer<typeof folderSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Label = z.infer<typeof labelSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type CommentProvider = z.infer<typeof commentProviderSchema>;
export type DisplayComment = z.infer<typeof displayCommentSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type TaskThread = z.infer<typeof taskThreadSchema>;
export type TaskCardMeta = z.infer<typeof taskCardMetaSchema>;
export type TaskPullRequest = z.infer<typeof taskPullRequestSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type FieldDisplayConfig = z.infer<typeof fieldDisplayConfigSchema>;
export type SavedView = z.infer<typeof savedViewSchema>;
export type SavedViewFilters = z.infer<typeof savedViewFiltersSchema>;
export type BoardGrouping = z.infer<typeof boardGroupingSchema>;
export type CreateSavedViewInput = z.infer<typeof createSavedViewInputSchema>;
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
