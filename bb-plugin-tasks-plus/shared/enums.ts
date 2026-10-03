// Task enums and the types derived from them. No zod, no @get-bb/plugin-sdk:
// this module is pulled into the frontend bundle (views take status,
// priority, etc. constants from here). The RPC contract definition lives in
// contract.js and pulls in the server SDK — the host shims that only for
// the server build on a git install, so the frontend-safe values are kept
// here instead. contract.js re-exports them, so server code still imports
// them from contract.

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

/** Statuses that still owe work — what a burndown burns down, an analytics tile counts open and a card's open sub-tasks are. */
export const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review"] as const satisfies readonly (typeof TASK_STATUSES)[number][];

const OPEN: ReadonlySet<string> = new Set(OPEN_STATUSES);

/** Whether a status still owes work (OPEN_STATUSES). */
export const isOpenStatus = (status: (typeof TASK_STATUSES)[number]): boolean => OPEN.has(status);

export const TASK_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;

// Mirror of db/types.ts — kept in sync by hand, like TASK_STATUSES above.
export const TASK_TYPES = [
  "epic",
  "feature",
  "bugfix",
  "spike",
  "refactor",
  "migration",
  "design",
] as const;

export const TASK_ESTIMATES = ["xs", "s", "m", "l", "xl"] as const;

export const PRESET_ENVIRONMENT_KINDS = [
  "project-default",
  "new-worktree",
] as const;

export const PRESET_PERMISSION_MODES = [
  "accept-edits",
  "auto",
  "full",
] as const;

// Dictionary of Display menu fields (the display order of a task row in the
// list/on the board). The order is canonical — it's the order fields are
// shown in by default and the order the user can rearrange them in. The
// dictionary is pushed down to layer 1: the client settings module
// (views/common/row-field-preference.ts) must import ROW_FIELDS/RowField from
// here rather than keep its own copy — otherwise the client's field list
// and the server's saved-view validation would drift apart.
/**
 * Client-side list sorts. A superset of the server's keyset sorts
 * (`TASK_SORTS` in pagination.ts): estimate, time and money sorts are applied
 * in-memory over the fully-loaded list. Lives here rather than in sort.ts
 * because `contract.ts` validates a saved view's sort against it, and
 * sort.ts type-depends on contract.ts — importing it there would close a
 * type cycle that makes TypeScript infer `unknown` across the RPC contract.
 */
export const LIST_SORTS = [
  "manual",
  "priority",
  "due",
  "start",
  "estimate",
  "planned_minutes",
  "actual_minutes",
  "budget",
  "budget_limit",
  "cost",
  "created",
  "updated",
] as const;

export type ListSort = (typeof LIST_SORTS)[number];

/**
 * What a board can lay its columns out by: a property of the task, or
 * nothing — then the cards lie in one grid. Lives here, beside LIST_SORTS,
 * for the same reason: the client needs the values and must not pull them
 * out of contract.ts.
 */
export const BOARD_GROUP_PROPERTIES = [
  "status",
  "priority",
  "type",
  "estimate",
  "assignee",
  "label",
] as const;

export const BOARD_GROUP_BYS = [...BOARD_GROUP_PROPERTIES, "none"] as const;

/** Bounds of a dragged column width, px; the board draws 230 by default. */
export const BOARD_COLUMN_WIDTH = { min: 200, max: 480, initial: 230 } as const;

/**
 * How many columns an ungrouped board lays its cards out in: a fixed count,
 * or "auto" — as many 15rem columns as fit.
 */
export const BOARD_GRID_COLUMN_COUNTS = [1, 2, 3, 4, 5, 6] as const;
export type BoardGridColumns = "auto" | (typeof BOARD_GRID_COLUMN_COUNTS)[number];

/**
 * Which sub-tasks a card's sub-task list shows: all of them, the open ones
 * at any depth, or the open children one level down. Open is neither done
 * nor canceled.
 */
export const SUBTASK_SCOPES = ["all", "open", "open-children"] as const;
export type SubtaskScope = (typeof SUBTASK_SCOPES)[number];

/** Where a click on a task opens it: the plugin's main container, or the page's right panel. */
export const TASK_OPENINGS = ["main", "side-panel"] as const;
export type TaskOpening = (typeof TASK_OPENINGS)[number];

export type BoardGroupProperty = (typeof BOARD_GROUP_PROPERTIES)[number];
export type BoardGroupBy = (typeof BOARD_GROUP_BYS)[number];

/** The two screens a task list opens as: a sortable table, or a grouped board. */
export const TASK_LAYOUTS = ["table", "board"] as const;
export type TaskLayout = (typeof TASK_LAYOUTS)[number];

/** A table column's sort direction. */
export const TABLE_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type TableSortDirection = (typeof TABLE_SORT_DIRECTIONS)[number];

/** Bounds of a dragged table column width, px. */
export const TABLE_COLUMN_WIDTH = { min: 64, max: 640 } as const;

export const ROW_FIELDS = [
  "parent",
  "title",
  "description",
  "key",
  "priority",
  "status",
  "slug",
  "active",
  "assignee",
  "flow",
  "type",
  "estimate",
  "labels",
  "subtasks",
  "attachments",
  "worktree",
  "takenBy",
  "subtaskList",
  "subtaskStats",
  "burndown",
  "gantt",
  "plannedMinutes",
  "actualMinutes",
  "budget",
  "budgetLimit",
  "cost",
  "dueDate",
  "startDate",
  "project",
  "createdAt",
  "updatedAt",
] as const;

/** A card's sub-task widgets: drawn from the task's tree, not values of the task — nothing to filter or sort by. */
export const WIDGET_FIELDS = ["subtaskList", "subtaskStats", "burndown", "gantt"] as const satisfies readonly (typeof ROW_FIELDS)[number][];

/** A field the filter and the sort offer: every row field but the widgets. */
export type QueryField = Exclude<(typeof ROW_FIELDS)[number], (typeof WIDGET_FIELDS)[number]>;

const WIDGETS: ReadonlySet<string> = new Set(WIDGET_FIELDS);

/** Whether a field is one the filter and the sort offer — any but a widget. */
export const isQueryField = (field: (typeof ROW_FIELDS)[number]): field is QueryField => !WIDGETS.has(field);

/** The fields the filter and the sort offer, in the canonical field order. */
export const QUERY_FIELDS: readonly QueryField[] = ROW_FIELDS.filter(isQueryField);

/** Sorts no card field holds: counted from the task's tree for ordering alone, so Filter and Display do not offer them. */
export const SORT_ONLY_FIELDS = ["openSubtasks"] as const;
export type SortOnlyField = (typeof SORT_ONLY_FIELDS)[number];

/** What a sort names: a row field, or a sort of its own. */
export type SortField = (typeof ROW_FIELDS)[number] | SortOnlyField;

/** Every name a stored sort may carry. */
export const SORT_FIELDS = [...ROW_FIELDS, ...SORT_ONLY_FIELDS] as const;

/** What the Sort menu offers, in order: the query fields, Open sub-tasks right after Sub-tasks. */
export const SORT_MENU_FIELDS: readonly (QueryField | SortOnlyField)[] = QUERY_FIELDS.flatMap((field) =>
  field === "subtasks" ? [field, "openSubtasks" as const] : [field],
);

/**
 * The first filters, each under a key of its own in a view's filters: the
 * field each narrows, and its key. The one place that pairing is written.
 */
export const LISTED_FILTER_KEYS = {
  status: "statuses",
  priority: "priorities",
  type: "types",
  estimate: "estimates",
  labels: "labelNames",
  assignee: "assignees",
  parent: "parents",
} as const satisfies Partial<Record<QueryField, string>>;
export type ListedFilterField = keyof typeof LISTED_FILTER_KEYS;

/** How a field is filtered: one of the first filters, picked values, contained text, or a range of days or numbers. */
export type FilterKind = "listed" | "values" | "text" | "date" | "number";

/**
 * Every field's filter kind. A field added to ROW_FIELDS does not compile
 * until it is given one here — and a kind's field list below must match.
 */
export const FIELD_FILTER_KINDS = {
  parent: "listed",
  title: "text",
  description: "text",
  key: "text",
  priority: "listed",
  status: "listed",
  slug: "text",
  active: "values",
  assignee: "listed",
  flow: "values",
  type: "listed",
  estimate: "listed",
  labels: "listed",
  subtasks: "number",
  attachments: "number",
  worktree: "values",
  takenBy: "values",
  plannedMinutes: "number",
  actualMinutes: "number",
  budget: "number",
  budgetLimit: "number",
  cost: "number",
  dueDate: "date",
  startDate: "date",
  project: "values",
  createdAt: "date",
  updatedAt: "date",
} as const satisfies Record<QueryField, FilterKind>;

/**
 * Picked-from-a-list filters added after the first seven (statuses …
 * parents, which keep their own keys): the task's project, flow, worktree,
 * the machine that took it and whether an agent works on it.
 */
export const VALUE_FILTER_FIELDS = ["project", "flow", "worktree", "takenBy", "active"] as const satisfies readonly QueryField[];
export type ValueFilterField = (typeof VALUE_FILTER_FIELDS)[number];

/** Fields filtered by "contains". */
export const TEXT_FIELDS = ["title", "description", "key", "slug"] as const satisfies readonly QueryField[];
export type TextField = (typeof TEXT_FIELDS)[number];

/** Fields filtered by a from–to range of days. */
export const DATE_FIELDS = ["dueDate", "startDate", "createdAt", "updatedAt"] as const satisfies readonly QueryField[];
export type DateField = (typeof DATE_FIELDS)[number];

/** Fields filtered by a from–to range of numbers; sub-tasks and attachments are counts. */
export const NUMBER_FIELDS = [
  "plannedMinutes",
  "actualMinutes",
  "budget",
  "budgetLimit",
  "cost",
  "subtasks",
  "attachments",
] as const satisfies readonly QueryField[];
export type NumberField = (typeof NUMBER_FIELDS)[number];

type FieldsOfKind<K extends FilterKind> = {
  [F in QueryField]: (typeof FIELD_FILTER_KINDS)[F] extends K ? F : never;
}[QueryField];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Compile-time only: each kind's field list is exactly the fields FIELD_FILTER_KINDS gives that kind.
const KIND_LISTS_MATCH: Same<FieldsOfKind<"listed">, ListedFilterField> &
  Same<FieldsOfKind<"values">, ValueFilterField> &
  Same<FieldsOfKind<"text">, TextField> &
  Same<FieldsOfKind<"date">, DateField> &
  Same<FieldsOfKind<"number">, NumberField> = true;
void KIND_LISTS_MATCH;

/** A counted field: never empty, zero is a value. */
export const COUNT_FIELDS = ["subtasks", "attachments"] as const satisfies readonly NumberField[];

/** The value an "active" filter picks: an agent works on the task, or none does. */
export const ACTIVITY_VALUES = ["active", "idle"] as const;

/** The value a "worktree" filter picks for a task read from the main checkout. */
export const MAIN_CHECKOUT = "main";

/** Fields a board card draws full width, each on its own: the title, the description and the sub-task blocks. */
export const CARD_BLOCK_FIELDS = ["title", "description", "subtaskList", "subtaskStats", "burndown", "gantt"] as const satisfies readonly (typeof ROW_FIELDS)[number][];

/**
 * Fields only a board card offers: its blocks but the description, which the
 * table draws as a column of its first paragraph, and the marks the card drew
 * in its top line before they were fields. The table keeps its title first
 * and each row one line.
 */
export const BOARD_ONLY_FIELDS: readonly (typeof ROW_FIELDS)[number][] = [
  ...CARD_BLOCK_FIELDS.filter((field) => field !== "description"),
  "parent",
  "attachments",
  "worktree",
];

/**
 * How long a board's card charts run, in whole units of the board's chart
 * unit (CHART_UNITS): that many columns of the unit, or — at ALL_TIME — the
 * whole history by the week, opening at the oldest task.
 */
export type CardChartPeriod = number;

/** The period with no fixed length. */
export const ALL_TIME = 0;

/** The longest period a board takes, ten years of day columns — as many of any unit. */
export const MAX_CARD_CHART_PERIOD = 3650;

/** What a Gantt draws: the planned dates, the statuses the task actually went through, or both laid over each other. */
export const GANTT_MODES = ["plan", "fact", "both"] as const;
export type GanttMode = (typeof GANTT_MODES)[number];

/**
 * Where today stands in a card chart's window: at the right edge, the window
 * looking back over the past; in the middle, half back and half ahead; at
 * the left edge, the window looking ahead to plan.
 */
export const TODAY_PLACES = ["left", "center", "right"] as const;
export type TodayPlace = (typeof TODAY_PLACES)[number];

/** What a card chart period counts: days, hours or minutes back from now. */
export const CHART_UNITS = ["days", "hours", "minutes"] as const;
export type ChartUnit = (typeof CHART_UNITS)[number];

/** How long one of a period's units is. */
export const CHART_UNIT_MS: Record<ChartUnit, number> = { days: 86_400_000, hours: 3_600_000, minutes: 60_000 };

/** How thickly the dates under the card charts are written: a few, some, many. */
export const DATE_DENSITIES = ["few", "some", "many"] as const;
export type DateDensity = (typeof DATE_DENSITIES)[number];

/** Where a card writes its chart dates: nowhere, under each chart, or once along the card's bottom. */
export const DATE_PLACES = ["off", "charts", "card"] as const;
export type DatePlace = (typeof DATE_PLACES)[number];

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskEstimate = (typeof TASK_ESTIMATES)[number];
export type RowField = (typeof ROW_FIELDS)[number];

/**
 * Имя служебного поля, которым интерфейс называет свой тред во входе RPC.
 * Живёт здесь, а не в contract.js: поле знают обе стороны — обёртка
 * обработчиков и клиент, — а contract.js тянет серверный SDK, которого во
 * фронтенд-бандле нет (см. шапку файла).
 */
export const CALLER_THREAD_FIELD = "callerThreadId";

/**
 * Методы, которым нужно знать рабочее дерево вызывающего: они читают или
 * пишут файлы задач. Доски, папки, метки, пресеты, виды и аналитика живут в
 * kv плагина и дерева не знают; `deleteLabel` исключение — он обходит задачи
 * и переписывает их файлы.
 */
export const CALLER_SCOPED_METHODS = [
  "createTask",
  "getTask",
  "getTaskByKey",
  "updateTask",
  "deleteTask",
  "revealTaskSource",
  "listTasks",
  "listPlacements",
  "boardMove",
  "createComment",
  "listComments",
  "listAttachments",
  "deleteAttachment",
  "listTaskThreads",
  "taskCardMeta",
  "tasksForThread",
  "listTaskPullRequests",
  "deleteLabel",
  // Делегирование живёт в своём контракте, но правит тот же файл задачи:
  // заводит тред, переводит задачу в работу и пишет системный комментарий.
  "delegate",
] as const;

const CALLER_SCOPED = new Set<string>(CALLER_SCOPED_METHODS);

/** Есть ли у метода понятие «из какого дерева пришёл вызов». */
export function isCallerScopedMethod(method: string): boolean {
  return CALLER_SCOPED.has(method);
}

/**
 * Снимает служебное поле со входа: обработчику достаётся вход без него, а
 * вызывающему — тред, из которого пришёл запрос. Обратная к `addCallerThread`,
 * и обе живут рядом, чтобы переименование поля не разошлось на половины.
 */
export function takeCallerThread(input: unknown): {
  threadId: string | null;
  rest: unknown;
} {
  if (typeof input !== "object" || input === null) return { threadId: null, rest: input };
  const { [CALLER_THREAD_FIELD]: value, ...rest } = input as Record<string, unknown>;
  const threadId = typeof value === "string" && value !== "" ? value : null;
  return { threadId, rest: threadId === null ? input : rest };
}

/**
 * Подмешивает тред во вход задачного метода. Вход, который уже несёт тред, не
 * перебивается: вызов, назвавший его сам, знает лучше контекста.
 */
export function addCallerThread(
  method: string,
  input: unknown,
  threadId: string | null,
): unknown {
  if (threadId === null || !isCallerScopedMethod(method)) return input;
  if (typeof input !== "object" || input === null) return input;
  if (CALLER_THREAD_FIELD in input) return input;
  return { ...input, [CALLER_THREAD_FIELD]: threadId };
}
