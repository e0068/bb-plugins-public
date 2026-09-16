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

export const TASK_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;

// Mirror of db/types.ts — kept in sync by hand, like TASK_STATUSES above.
export const TASK_TYPES = [
  "feature",
  "bugfix",
  "spike",
  "refactor",
  "migration",
  "design",
] as const;

export const TASK_ESTIMATES = ["xs", "s", "m", "l", "xl"] as const;

export const TASK_CHECKS = ["test", "review", "design", "browser"] as const;

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
// (views/list/row-field-preference.ts) must import ROW_FIELDS/RowField from
// here rather than keep its own copy — otherwise the client's field list
// and the server's saved-view validation would drift apart.
export const ROW_FIELDS = [
  "priority",
  "active",
  "assignee",
  "epic",
  "type",
  "estimate",
  "labels",
  "plannedMinutes",
  "actualMinutes",
  "budget",
  "budgetLimit",
  "cost",
  "dueDate",
  "project",
  "createdAt",
  "updatedAt",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskEstimate = (typeof TASK_ESTIMATES)[number];
export type TaskCheck = (typeof TASK_CHECKS)[number];
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
