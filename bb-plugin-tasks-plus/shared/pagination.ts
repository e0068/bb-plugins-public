export const TASK_SORTS = ["manual", "priority", "due"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** Default page size for task-list RPC and CLI requests. */
export const TASKS_PAGE_DEFAULT_LIMIT = 100;

/** Largest task page the list contract accepts: big enough that a whole workspace usually fits in one. */
export const TASKS_PAGE_MAX_LIMIT = 2000;

/** Most task ids one taskCardMeta call accepts; the client asks in chunks. */
export const TASK_CARD_META_MAX_IDS = 1000;
