import type { Attachment } from "../db/types.js";
import type { Comment, Task } from "../shared/contract.js";
import { parseAttachedThreads, type AttachedThread } from "../threads/live-state.js";
import type { BoardTaskFile } from "./fs-boards.js";

const KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/;

/** The board's label for a task, `PREFIX-NUMBER`, as the file wrote it —
 *  or null when the string is not one (then the file counts as keyless). */
export function parseTaskKey(raw: string): { key: string; number: number } | null {
  const match = KEY_PATTERN.exec(raw.trim());
  return match ? { key: match[0], number: Number(match[2]) } : null;
}

/** A task's slug — its file name — read back out of its id, which is
 *  `<boardId>:<slug>` (see `assembleBoardTasks`). */
export function taskSlug(task: Pick<Task, "id" | "projectId">): string {
  return task.id.slice(task.projectId.length + 1);
}

export interface AssembledTask {
  task: Task;
  comments: Comment[];
  /** Attachment facts only — a thread's live status is not in the file (see
   *  threads/live-state.ts); filesync/store.ts adds it on top. */
  threads: AttachedThread[];
  attachments: Attachment[];
}

export interface AssembleResult {
  tasks: AssembledTask[];
}

function rawArray(frontmatter: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = frontmatter[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function attachmentsOf(taskId: string, frontmatter: Record<string, unknown>): Attachment[] {
  return rawArray(frontmatter, "attachments")
    .filter((e) => typeof e.id === "string")
    .map((e) => ({
      id: e.id as string,
      taskId,
      commentId: typeof e.commentId === "string" ? e.commentId : null,
      fileName: typeof e.fileName === "string" ? e.fileName : "",
      mime: typeof e.mime === "string" ? e.mime : "application/octet-stream",
      sizeBytes: typeof e.sizeBytes === "number" ? e.sizeBytes : 0,
      blobPath: typeof e.blobPath === "string" ? e.blobPath : "",
      isImage: Boolean(e.isImage),
      createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
    }));
}

/**
 * Turns one board's raw file reads into typed Task/Comment/TaskThread/
 * Attachment records — a straight field mapping, nothing computed or
 * invented: a value present in the file is used as-is, a value absent stays
 * absent (or, for `key`, falls back to the slug — the file is a task
 * either way). Labels are the names from the file
 * directly (`labelIds` IS the name list — there is no separate label id).
 */
export function assembleBoardTasks(
  board: { id: string },
  files: readonly BoardTaskFile[],
): AssembleResult {
  const partial = files
    .map((file) => {
      // A file in a status folder is a task, full stop. `key` is the
      // board's short label for it and most files never got one — they were
      // written by hand or by an agent, and only the board issues numbers.
      // Such a task is shown under its slug, which is its identity anyway
      // (`id` is `<boardId>:<slug>`); hiding it made the board disagree with
      // the folder it claims to be (see
      // decisions/tasks-every-file-in-a-status-folder-is-a-task.md).
      const label = file.task.key ? parseTaskKey(file.task.key) : null;
      const id = `${board.id}:${file.slug}`;
      const task: Task = {
        id,
        projectId: board.id,
        number: label?.number ?? null,
        key: label?.key ?? file.slug,
        title: file.task.title ?? file.slug,
        description: file.task.description ?? "",
        status: file.status,
        priority: file.task.priority ?? "none",
        type: file.task.type ?? null,
        estimate: file.task.estimate ?? null,
        plannedMinutes: file.task.plannedMinutes ?? null,
        actualMinutes: file.task.actualMinutes ?? null,
        budget: file.task.budget ?? null,
        budgetLimit: file.task.budgetLimit ?? null,
        cost: file.task.cost ?? null,
        dueDate: file.task.dueDate ?? null,
        parentTaskId: null, // resolved below, once every task has an id
        position: 0,
        // From the filesystem, not from `created:`/`updated:` — almost no
        // file carries those, every file has the times.
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        labelIds: [...(file.task.labels ?? [])],
        checks: [...(file.task.checks ?? [])],
        // From the folders above the status folder, not the frontmatter.
        assignee: file.assignee,
        epic: file.epic,
        source: { filePath: file.filePath, origin: file.origin },
      };
      return {
        task,
        comments: file.comments.map((c) => ({ ...c, taskId: id })),
        threads: parseAttachedThreads(id, file.frontmatter),
        attachments: attachmentsOf(id, file.frontmatter),
        parentRef: file.task.parentRef,
        slug: file.slug,
      };
    });

  // `parent:` names either the key the board issued or the slug the author
  // chose, and a keyless task only has the latter — both resolve here.
  const byRef = new Map<string, string>();
  for (const p of partial) {
    byRef.set(p.slug.toLowerCase(), p.task.id);
    byRef.set(p.task.key.toLowerCase(), p.task.id);
  }
  const tasks: AssembledTask[] = partial.map(({ parentRef, slug: _slug, ...rest }) => ({
    ...rest,
    task: {
      ...rest.task,
      parentTaskId: parentRef ? (byRef.get(parentRef.toLowerCase()) ?? null) : null,
    },
  }));

  return { tasks };
}
