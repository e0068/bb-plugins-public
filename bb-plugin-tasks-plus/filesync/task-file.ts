import type { TaskCheck } from "../db/types.js";
import type { Comment, Task } from "../shared/contract.js";
import { parseFrontmatter } from "./frontmatter.js";
import { mapFrontmatter } from "./map.js";
import { parseComments, renderComments } from "./comments.js";
import { stringify as stringifyYaml } from "yaml";
import { AMOUNT_FIELDS, type AmountField } from "../shared/amounts.js";

/** The file's own fields, minus what assemble.ts computes from them
 *  (labelIds/checks/source) — labels/checks/parentRef are this module's
 *  own names for the file's raw values before that computation. */
type TaskFields = Partial<Omit<Task, "labelIds" | "checks" | "source">>;

export interface ParsedTaskFile {
  task: TaskFields & { labels: string[]; checks: TaskCheck[]; parentRef: string | null };
  comments: Comment[];
  /** Raw frontmatter, for fields this module doesn't model itself (threads,
   *  attachments, and anything a future caller needs) — see filesync/store.ts. */
  frontmatter: Record<string, unknown>;
}

type Status = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";

export function parseTaskFile(
  content: string,
  status: Status,
  slug: string,
): ParsedTaskFile {
  // A block that does not parse leaves every field empty rather than
  // rejecting the file: the file is in a status folder, so it is a task,
  // and the board must show it under its own name (see
  // decisions/tasks-every-file-in-a-status-folder-is-a-task.md).
  const { data, body } = parseFrontmatter(content);

  const commentMarker = "\n## Comments\n";
  const commentIdx = body.indexOf(commentMarker);
  const description = commentIdx >= 0 ? body.slice(0, commentIdx).trim() : body;
  const commentsBody = commentIdx >= 0 ? body.slice(commentIdx + commentMarker.length) : "";

  const mapped = mapFrontmatter(data, status, slug, description);
  const comments = parseComments(commentsBody);

  const task = {
    ...mapped,
    id: typeof data.id === "string" ? data.id : undefined,
    key: typeof data.key === "string" ? data.key : undefined,
  };

  return { task, comments, frontmatter: data };
}

/** Frontmatter key of each time/money field. */
export const AMOUNT_KEYS: Record<AmountField, string> = {
  plannedMinutes: "minutes",
  actualMinutes: "minutes_actual",
  budget: "budget",
  budgetLimit: "limit",
  cost: "cost",
};

/**
 * Renders task + comments back to markdown. `extraFields` (threads,
 * attachments — anything task-file.ts doesn't model) are merged in last, so
 * they always win over this function's own computed fields.
 */
export function renderTaskFile(
  task: Partial<Task> & {
    labels?: readonly string[];
    checks?: readonly TaskCheck[];
    parentRef?: string | null;
  },
  slug: string,
  comments: readonly Comment[],
  existingData: Record<string, unknown> = {},
  extraFields: Record<string, unknown> = {},
): string {
  const frontmatter: Record<string, unknown> = { ...existingData, title: task.title, slug };
  // The board never reads `updated:` back — `updatedAt` comes from the
  // file's own mtime (see timestamps.ts) — and every write used to stamp
  // one anyway, which is exactly the line two independent edits collide on
  // when the tasks folder is union-merged. Stop emitting it, and drop it
  // from files carried over from before this: it costs nothing to keep and
  // nothing to lose by removing.
  delete frontmatter.updated;

  if (task.key) frontmatter.key = task.key;
  if (task.type) frontmatter.type = task.type;
  if (task.priority && task.priority !== "none") frontmatter.priority = task.priority;
  if (task.estimate) frontmatter.estimate = task.estimate;
  // Only a value is written. A null here may be a line the reader could not
  // parse ("1h 30m"), so it stays as the file had it; clearing a field takes
  // its key out of `existingData` before this call (store.ts updateTask).
  // Legacy `tokens` lines ride along untouched the same way.
  for (const field of AMOUNT_FIELDS) {
    const value = task[field];
    if (value != null) frontmatter[AMOUNT_KEYS[field]] = value;
  }
  if (task.dueDate) frontmatter.due = task.dueDate;
  if (task.labels && task.labels.length > 0) frontmatter.labels = [...task.labels];
  else delete frontmatter.labels;
  if (task.checks && task.checks.length > 0) frontmatter.checks = [...task.checks];
  else delete frontmatter.checks;
  if (task.parentRef) frontmatter.parent = task.parentRef;
  else delete frontmatter.parent;

  Object.assign(frontmatter, extraFields);

  const yaml = stringifyYaml(frontmatter).trimEnd();
  const description = (task.description ?? "").trim();
  const commentsSec = renderComments(comments);
  return `---\n${yaml}\n---\n\n${description}${commentsSec ? "\n\n" + commentsSec : ""}`;
}
