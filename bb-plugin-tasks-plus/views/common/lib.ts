import { formatPlanDate, planMomentOf } from "../../shared/plan-date.js";
import {
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/enums.js";
import type { Label, Task } from "../../shared/contract.js";
import { slugOf } from "../../shared/format.js";
import { descendantsOf } from "../../shared/subtree.js";

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

export interface TaskTreeEntry {
  task: Task;
  /** 0 for a top-level task, or a subtask whose parent isn't in this list;
   * one more for each level it lies under a parent present in the list. */
  depth: number;
  /** Status bucket the row groups under: its own status at depth 0, or the
   * status of the top task it lies under — a subtask always surfaces beside
   * its parent, whatever its own status is. */
  groupStatus: TaskStatus;
}

/**
 * Nests each subtask directly after its parent, at any depth, preserving the
 * incoming order otherwise. A subtask whose parent isn't present in the list
 * (filtered out) surfaces at depth 0 under its own status — there's no parent
 * row for it to attach under.
 */
export function nestSubtasks(tasks: readonly Task[]): TaskTreeEntry[] {
  const presentIds = new Set(tasks.map((task) => task.id));
  const present = tasks.map((task) =>
    task.parentTaskId !== null && presentIds.has(task.parentTaskId) ? task : { ...task, parentTaskId: null },
  );
  const tree = descendantsOf(present);
  const listed = new Set(
    present.flatMap((task) => (task.parentTaskId === null ? [task.id, ...(tree.get(task.id) ?? []).map(({ task: under }) => under.id)] : [])),
  );
  // A parent cycle has no top task, so its members come in as tops of their own.
  const tops = present.filter((task) => task.parentTaskId === null || !listed.has(task.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tops.flatMap((top): TaskTreeEntry[] => [
    { task: byId.get(top.id)!, depth: 0, groupStatus: top.status },
    ...(top.parentTaskId === null ? (tree.get(top.id) ?? []) : []).map(
      ({ task, depth }): TaskTreeEntry => ({ task: byId.get(task.id)!, depth, groupStatus: top.status }),
    ),
  ]);
}

export interface StatusGroup {
  status: TaskStatus;
  entries: TaskTreeEntry[];
}

/**
 * Buckets tree entries into canonical status order by `groupStatus`, dropping
 * empty groups. Within a group the incoming order is preserved, so callers
 * control ordering by pre-sorting and pre-nesting (the server default is
 * board position).
 */
export function groupTasksByStatus(
  entries: readonly TaskTreeEntry[],
): StatusGroup[] {
  const byStatus = new Map<TaskStatus, TaskTreeEntry[]>();
  for (const entry of entries) {
    const bucket = byStatus.get(entry.groupStatus);
    if (bucket) bucket.push(entry);
    else byStatus.set(entry.groupStatus, [entry]);
  }
  return TASK_STATUSES.flatMap((status) => {
    const bucket = byStatus.get(status);
    return bucket ? [{ status, entries: bucket }] : [];
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

/** "2026-07-18" → "Jul 18" (with the year appended when it isn't this year). */
/** A parent the filter offers: picked by id, found by its key, slug and title. */
export interface ParentFilterOption {
  value: string;
  key: string;
  slug: string;
  title: string;
  type: Task["type"];
}

/**
 * The tasks the parent filter offers: those with a task under them in the
 * list, so none picks an empty view — epics first, then the rest, each group
 * by key and title. Built from the loaded tasks, like the other filter
 * values, so the same code serves every list and board.
 */
export function parentFilterOptions(tasks: readonly Task[]): ParentFilterOption[] {
  const parentIds = new Set(tasks.flatMap((task) => (task.parentTaskId === null ? [] : [task.parentTaskId])));
  const byName = (a: ParentFilterOption, b: ParentFilterOption) => `${a.key} ${a.title}`.localeCompare(`${b.key} ${b.title}`);
  const options = tasks
    .filter((task) => parentIds.has(task.id))
    .map((task) => ({ value: task.id, key: task.key, slug: slugOf(task.id), title: task.title, type: task.type }))
    .sort(byName);
  return [...options.filter((option) => option.type === "epic"), ...options.filter((option) => option.type !== "epic")];
}

export function formatDueDate(dueDate: string, today = new Date()): string {
  return formatPlanDate(dueDate, today);
}

/**
 * ISO timestamp (createdAt/updatedAt) → "Jul 18, 14:34" on the viewer's
 * clock, the year added outside `today`'s: a moment always shows its hours
 * and minutes. Parses the full datetime; `formatDueDate` handles the plan
 * dates, which carry no zone and must not shift across one.
 */
export function formatTimestamp(iso: string, today = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  return formatPlanDate(planMomentOf(date), today);
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
