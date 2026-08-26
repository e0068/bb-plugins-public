// Перечисления задач и производные от них типы. Ни zod, ни @get-bb/plugin-sdk:
// этот модуль тянут во фронтенд-бандл (вьюхи берут отсюда константы статусов,
// приоритетов и т.п.). Определение RPC-контракта живёт в contract.js и тянет
// серверный SDK — его хост при git-install шимит только серверной сборке, поэтому
// фронтенд-безопасные значения вынесены сюда. contract.js ре-экспортит их, так
// что серверный код по-прежнему импортирует их из contract.

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

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskEstimate = (typeof TASK_ESTIMATES)[number];
export type TaskCheck = (typeof TASK_CHECKS)[number];
