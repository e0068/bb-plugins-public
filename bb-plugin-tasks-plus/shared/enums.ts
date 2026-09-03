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
  "type",
  "estimate",
  "labels",
  "tokens",
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
