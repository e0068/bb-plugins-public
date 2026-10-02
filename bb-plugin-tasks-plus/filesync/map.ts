import {
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskEstimate,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "../db/types.js";
import { readDollars, readMinutes } from "../shared/amounts.js";
import type { Task } from "../shared/contract.js";
import { isPlanDate } from "../shared/plan-date.js";
import type { TakenBy } from "../shared/task-claim.js";

/** A task assembled from one markdown file's frontmatter + its folder. */
export interface MappedTaskFile {
  slug: string;
  title: string;
  /** The file's markdown body — everything after the frontmatter block. */
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType | null;
  estimate: TaskEstimate | null;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  budget: number | null;
  budgetLimit: number | null;
  cost: number | null;
  dueDate: string | null;
  startDate: string | null;
  labels: string[];
  /** Parent task's slug or key, when the file declares one. */
  parentRef: string | null;
  /** The flow the Flow plugin stamped into the file, null when none. */
  flow: TaskFlow | null;
  /** Who took the task, from the file's `taken_by:` block; absent when nobody
   *  did — assemble.ts reads that as null. */
  takenBy?: TakenBy;
}

/** A flow as the file's `flow:` block names it — see mapFlow. */
export type TaskFlow = NonNullable<Task["flow"]>;

// Spaces and hyphens read as underscores, so "In progress" and the old
// project-memory-v2 "in-progress" both land on in_progress; "to do" and
// "to-do" still need a word joined.
const STATUS_ALIASES: Record<string, TaskStatus> = {
  to_do: "todo",
};

/** Maps an immediate subfolder name to a task status, or null if unknown. */
export function statusFromFolder(folder: string): TaskStatus | null {
  const normalized = folder.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((TASK_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as TaskStatus;
  }
  return STATUS_ALIASES[normalized] ?? null;
}

/** Frontmatter `minutes`/`minutes_actual`: whole minutes, junk reads as null. */
export const parseMinutes = readMinutes;

/** Frontmatter `budget`/`limit`/`cost`: dollars on whole cents, junk reads as null. */
export const parseDollars = readDollars;

function enumOr<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T | null,
): T | null {
  // Case-insensitive: real frontmatter writes estimates as "M"/"XL", etc.
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if ((allowed as readonly string[]).includes(lower)) return lower as T;
  }
  return fallback;
}

// Legacy type aliases: the value is no longer part of TASK_TYPES, but old
// task files still contain it and shouldn't lose their type. See
// docs/decisions/tasks-drop-chore-shallow-migration.md
const LEGACY_TYPE_ALIASES: Record<string, TaskType> = { chore: "refactor" };

function mapType(value: unknown): TaskType | null {
  if (typeof value === "string") {
    const alias = LEGACY_TYPE_ALIASES[value.trim().toLowerCase()];
    if (alias) return alias;
  }
  return enumOr<TaskType>(value, TASK_TYPES, null);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

/**
 * The `flow:` block the Flow plugin writes when a run's stage hands the file
 * back as a result: `{ id, name }`, both non-blank strings. Anything else
 * reads as no flow. The board never writes the block — it rides along in the
 * file's untouched frontmatter (task-file.ts renderTaskFile).
 */
export function mapFlow(value: unknown): TaskFlow | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name } = value as Record<string, unknown>;
  return typeof id === "string" && id.trim() !== "" && typeof name === "string" && name.trim() !== "" ? { id, name } : null;
}

/**
 * The `taken_by:` block a write of the store leaves on a task that was taken:
 * `{ machine, thread, at }` — a non-blank machine and time, and a thread that
 * is a string or absent. A missing or broken block reads as nobody: the board
 * must not fail on a file a person edited by hand.
 */
export function mapTakenBy(value: unknown): TakenBy | null {
  if (typeof value !== "object" || value === null) return null;
  const { machine, thread, at } = value as Record<string, unknown>;
  if (typeof machine !== "string" || machine.trim() === "") return null;
  if (typeof at !== "string" || at.trim() === "") return null;
  return { machine, threadId: typeof thread === "string" && thread !== "" ? thread : null, at };
}

/**
 * CRLF → LF, blank lines off both ends. Leading spaces on the first real line
 * survive: `trim()` would dedent an opening indented code block and leave the
 * rest of it indented, which is broken markdown rather than tidier markdown.
 */
function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/^\n+/, "").trimEnd();
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Builds a task from parsed frontmatter, its resolved status and the file's
 * markdown `body`, which becomes the task description verbatim. `slugFallback`
 * (e.g. the filename) is used when the frontmatter omits `slug`. Unknown enum
 * values fall back (type/estimate → null, priority → "none"); invalid dates,
 * minutes and dollar amounts drop to null. Legacy `tokens`/`tokens_actual`
 * and `checks` lines are not read. The mapping never throws.
 */
export function mapFrontmatter(
  data: Record<string, unknown>,
  status: TaskStatus,
  slugFallback: string,
  body = "",
): MappedTaskFile {
  const slug = firstString(data.slug) ?? slugFallback;
  const due = firstString(data.due);
  const start = firstString(data.start);
  const takenBy = mapTakenBy(data.taken_by);
  return {
    slug,
    title: firstString(data.title) ?? slug,
    description: normalizeBody(body),
    status,
    priority: enumOr<TaskPriority>(data.priority, TASK_PRIORITIES, "none") ?? "none",
    type: mapType(data.type),
    estimate: enumOr<TaskEstimate>(data.estimate, TASK_ESTIMATES, null),
    plannedMinutes: parseMinutes(data.minutes),
    actualMinutes: parseMinutes(data.minutes_actual),
    budget: parseDollars(data.budget),
    budgetLimit: parseDollars(data.limit),
    cost: parseDollars(data.cost),
    dueDate: due !== null && isPlanDate(due) ? due : null,
    startDate: start !== null && isPlanDate(start) ? start : null,
    labels: stringArray(data.labels),
    parentRef: firstString(data.parent),
    flow: mapFlow(data.flow),
    ...(takenBy === null ? {} : { takenBy }),
  };
}
