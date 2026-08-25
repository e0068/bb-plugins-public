import { createHash } from "node:crypto";
import type { Project, TasksStore } from "../db/index.js";
import { parseLegacySourceMarker } from "./legacy-source.js";
import type { MappedTaskFile } from "./map.js";

export interface ScannedFile {
  mapped: MappedTaskFile;
  /** Repo-relative path of the markdown file (identity for moves/status). */
  filePath: string;
  /**
   * Digest of `mapped`, not of the file's bytes: it gates the "unchanged,
   * skip it" shortcut, and what must not be skipped is a change in the task
   * a file maps to. Digesting the mapping result means a change to the
   * mapping rules invalidates every stored digest on its own, with no version
   * to remember to bump — and an edit that leaves every field alone stops
   * costing an update.
   */
  contentSha: string;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface SyncSummary {
  created: number;
  updated: number;
  /** Existing tasks matched to a real file by legacy-marker slug, instead of
   * creating a duplicate (see `syncProjectFiles` doc comment). */
  adopted: number;
  deleted: number;
  unchanged: number;
  /** Files whose frontmatter failed to parse (see filesync/scan.ts's
   * `InvalidFile`) — not created, updated, or deleted; just counted. */
  invalid: number;
}

export interface SyncOptions {
  /** Compute the summary without writing anything (no create/update/adopt/
   * delete, no label creation). Used by `bb tasks sync --dry-run`. */
  dryRun?: boolean;
  /**
   * Repo-relative paths of this scan's INVALID files (unreadable
   * frontmatter — see filesync/scan.ts). These files were never mapped, so
   * their slug never enters `seen`; without this set the deletion pass below
   * would read that absence as "the file is gone" and delete the file's
   * existing task. A typo that breaks a title must not delete the task it
   * describes, so any existing task whose `filePath` is in this set is
   * exempted from deletion, same as a file that is still present.
   */
  invalidFilePaths?: ReadonlySet<string>;
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

// Neutral fill for labels the plugin auto-creates from frontmatter names.
const SYNC_LABEL_COLOR = "#6b7280";

/**
 * Reconciles one project's board tasks with the markdown files backing it.
 * Files are the source of truth: a new file creates a task, a changed file
 * updates it, a vanished file deletes it. Tasks are matched to files by
 * `slug` via the `file_tasks` link.
 *
 * Adoption: a file whose slug has no `file_tasks` link yet is first matched
 * against this project's unlinked tasks by their legacy "Источник: … · slug:
 * …" description marker (see `filesync/legacy-source.ts`). A match links the
 * existing task to the real file instead of creating a duplicate — this is
 * the one-time migration path off the pre-sync marker convention. Each
 * candidate task adopts at most once. Tasks with no matching file are left
 * untouched; they are never deleted by this pass.
 *
 * Pure over its `store` and `files` inputs (no I/O), so it is unit-testable.
 * `options.dryRun` computes the same summary without writing anything.
 */
export function syncProjectFiles(
  store: TasksStore,
  project: Project,
  files: readonly ScannedFile[],
  options: SyncOptions = {},
): SyncSummary {
  const dryRun = options.dryRun ?? false;
  const invalidFilePaths = options.invalidFilePaths ?? new Set<string>();
  const summary: SyncSummary = {
    created: 0,
    updated: 0,
    adopted: 0,
    deleted: 0,
    unchanged: 0,
    invalid: invalidFilePaths.size,
  };

  const labelIdByName = new Map<string, string>();
  for (const label of store.listLabels(project.id)) {
    labelIdByName.set(label.name.toLowerCase(), label.id);
  }
  const resolveLabels = (names: readonly string[]): string[] =>
    names.map((name) => {
      const key = name.toLowerCase();
      let id = labelIdByName.get(key);
      if (id === undefined) {
        id = store.createLabel({
          projectId: project.id,
          name,
          color: SYNC_LABEL_COLOR,
        }).id;
        labelIdByName.set(key, id);
      }
      return id;
    });

  const setTaskLabels = (taskId: string, wantIds: readonly string[]): void => {
    const current = new Set(
      store.listTaskLabels(taskId).map((link) => link.labelId),
    );
    const want = new Set(wantIds);
    for (const id of want) if (!current.has(id)) store.addTaskLabel(taskId, id);
    for (const id of current) if (!want.has(id)) store.removeTaskLabel(taskId, id);
  };

  // Adoption candidates: this project's tasks with no file_tasks link yet,
  // keyed by their legacy marker's normalized slug. Consumed (deleted from
  // the map) on match so two files can never adopt the same task.
  const linkedTaskIds = new Set(
    store.listFileTasks(project.id).map((fileTask) => fileTask.taskId),
  );
  const adoptionCandidates = new Map<string, string>();
  for (const task of store.listTasks({ projectId: project.id })) {
    if (linkedTaskIds.has(task.id)) continue;
    const legacy = parseLegacySourceMarker(task.description);
    if (!legacy) continue;
    const key = normalizeSlug(legacy.slug);
    if (!adoptionCandidates.has(key)) adoptionCandidates.set(key, task.id);
  }

  const seen = new Set<string>();
  const slugToTaskId = new Map<string, string>();

  for (const { mapped, filePath, contentSha } of files) {
    seen.add(mapped.slug);
    const existing = store.getFileTask(project.id, mapped.slug);
    const fields = {
      title: mapped.title,
      status: mapped.status,
      priority: mapped.priority,
      type: mapped.type,
      estimate: mapped.estimate,
      planTokens: mapped.planTokens,
      factTokens: mapped.factTokens,
      dueDate: mapped.dueDate,
      checks: mapped.checks,
      // An empty body says "this file carries no description", not "clear the
      // card". Sending "" would wipe text typed on the board — and for adopted
      // tasks that text is the only copy, plus the legacy marker that found
      // them. See decisions/task-description-empty-body.md.
      description: mapped.description || undefined,
    };

    if (
      existing &&
      existing.contentSha === contentSha &&
      existing.filePath === filePath
    ) {
      slugToTaskId.set(mapped.slug, existing.taskId);
      summary.unchanged += 1;
      continue;
    }

    const adoptedTaskId = existing
      ? undefined
      : adoptionCandidates.get(normalizeSlug(mapped.slug));
    const kind: "updated" | "adopted" | "created" = existing
      ? "updated"
      : adoptedTaskId
        ? "adopted"
        : "created";

    let taskId: string;
    if (kind === "updated" && existing) {
      taskId = existing.taskId;
      if (!dryRun) store.updateTask(taskId, fields);
    } else if (kind === "adopted" && adoptedTaskId) {
      taskId = adoptedTaskId;
      adoptionCandidates.delete(normalizeSlug(mapped.slug));
      if (!dryRun) store.updateTask(taskId, fields);
    } else if (!dryRun) {
      taskId = store.createTask({ projectId: project.id, ...fields }).id;
    } else {
      // Dry run: nothing was created, so there is no real id to report or
      // link labels/file_tasks against. Skip straight to counting below.
      summary.created += 1;
      continue;
    }

    if (!dryRun) {
      setTaskLabels(taskId, resolveLabels(mapped.labels));
      store.upsertFileTask({
        projectId: project.id,
        slug: mapped.slug,
        taskId,
        filePath,
        contentSha,
      });
    }
    slugToTaskId.set(mapped.slug, taskId);
    summary[kind] += 1;
  }

  // Parent linking, after every task exists: resolve parentRef (a slug) to id.
  // Skipped on dry run — nothing was actually created or adopted to link.
  if (!dryRun) {
    for (const { mapped } of files) {
      if (mapped.parentRef === null) continue;
      const childId = slugToTaskId.get(mapped.slug);
      const parentId =
        slugToTaskId.get(mapped.parentRef) ??
        store.getFileTask(project.id, mapped.parentRef)?.taskId;
      if (childId && parentId && childId !== parentId) {
        // One level of nesting is enforced by the store; ignore rejects.
        try {
          store.updateTask(childId, { parentTaskId: parentId });
        } catch {
          /* parent already a subtask, or would exceed one level */
        }
      }
    }
  }

  // Deletions: a file that disappeared removes its task (files are canonical).
  // `deleted` doubles as "would-delete" under dry run, since it is computed
  // from reads only (listFileTasks / seen) and never mutates either way.
  for (const existing of store.listFileTasks(project.id)) {
    if (!seen.has(existing.slug) && !invalidFilePaths.has(existing.filePath)) {
      if (!dryRun) store.deleteTask(existing.taskId); // cascades file_tasks
      summary.deleted += 1;
    }
  }

  return summary;
}
