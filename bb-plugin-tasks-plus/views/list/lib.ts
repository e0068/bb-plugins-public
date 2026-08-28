import {
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/enums.js";
import type { Label, Task } from "../../shared/contract.js";
import type { ListSort } from "../../shared/sort.js";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export const SORT_LABELS: Record<ListSort, string> = {
  manual: "Manual",
  priority: "Priority",
  due: "Due date",
  estimate: "Estimate",
  plan_tokens: "Tokens - Plan",
  fact_tokens: "Tokens - Fact",
};

export interface StatusGroup {
  status: TaskStatus;
  tasks: Task[];
}

/**
 * Buckets tasks into canonical status order, dropping empty groups. Within a
 * group the incoming order is preserved, so callers control ordering by
 * pre-sorting (the server default is board position).
 */
export function groupTasksByStatus(tasks: readonly Task[]): StatusGroup[] {
  const byStatus = new Map<TaskStatus, Task[]>();
  for (const task of tasks) {
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
    else byStatus.set(task.status, [task]);
  }
  return TASK_STATUSES.flatMap((status) => {
    const bucket = byStatus.get(status);
    return bucket ? [{ status, tasks: bucket }] : [];
  });
}

export interface LabelFilterOption {
  name: string;
  color: string;
  /** All label ids sharing this name (one per project on cross-project routes). */
  labelIds: string[];
}

/**
 * Collapses labels into name-keyed filter options so "Bug" on the All-tasks
 * route matches every project's Bug label with a single selection.
 */
export function labelFilterOptions(
  labels: readonly Label[],
): LabelFilterOption[] {
  const byName = new Map<string, LabelFilterOption>();
  for (const label of labels) {
    const existing = byName.get(label.name);
    if (existing) existing.labelIds.push(label.id);
    else
      byName.set(label.name, {
        name: label.name,
        color: label.color,
        labelIds: [label.id],
      });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function selectedLabelIds(
  options: readonly LabelFilterOption[],
  selectedNames: readonly string[],
): string[] {
  const selected = new Set(selectedNames);
  return options
    .filter((option) => selected.has(option.name))
    .flatMap((option) => option.labelIds);
}

/** 12000 → "12k", 1500000 → "1.5M"; below 1000 renders the exact count. */
export function formatTokenCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(value);
}

/** "2026-07-18" → "Jul 18" (with the year appended when it isn't this year). */
export function formatDueDate(dueDate: string, today = new Date()): string {
  const date = new Date(`${dueDate}T00:00:00`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/**
 * ISO timestamp (createdAt/updatedAt) → "Jul 18", with the year appended when
 * it isn't this year. Parses the full datetime; `formatDueDate` handles the
 * date-only due field, which must not shift across timezones.
 */
export function formatTimestamp(iso: string, today = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/**
 * Accessible name for the list-row activity dot. Callers only render the dot
 * when at least one thread is live, so the input is never empty.
 */
export function activeWorkLabel(
  threads: readonly { liveStatus: string }[],
): string {
  if (threads.length === 1) {
    return threads[0]?.liveStatus === "starting"
      ? "Agent starting"
      : "Agent working";
  }
  return `${threads.length} agents working`;
}

export interface LabelOverflow {
  visible: Label[];
  hidden: Label[];
}

/**
 * Splits row labels into visible chips and a "+N" overflow so rows stay a
 * bounded width no matter how many labels a task carries.
 */
export function partitionLabels(
  labels: readonly Label[],
  maxVisible: number,
): LabelOverflow {
  if (labels.length <= maxVisible) {
    return { visible: [...labels], hidden: [] };
  }
  return {
    visible: labels.slice(0, maxVisible),
    hidden: labels.slice(maxVisible),
  };
}
