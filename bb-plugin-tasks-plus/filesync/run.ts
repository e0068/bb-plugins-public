import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api/index.js";
import { createBbFileReader } from "./bb-reader.js";
import { mergeFileScans, type WorktreeScan, type WorktreeSource } from "./merge.js";
import { scanTaskFolder, type InvalidFile } from "./scan.js";
import { syncProjectFiles, type SyncSummary } from "./sync.js";
import { changedFilePaths } from "./worktree-changes.js";
import { listActiveWorktreeSources } from "./worktrees.js";

// `Omit`s SyncSummary's `invalid` (a count) to replace it with the list this
// caller actually has on hand — the count is just `invalid.length`.
export interface ProjectSyncResult extends Omit<SyncSummary, "invalid"> {
  projectId: string;
  prefix: string;
  tasksFolder: string;
  /** Count of valid, mapped files (INVALID files are excluded — see
   * `invalid` below and filesync/scan.ts). */
  fileCount: number;
  /** This scan's unreadable-frontmatter files, path plus reason. */
  invalid: InvalidFile[];
  /** Active worktrees (see filesync/worktrees.ts) whose file scan failed and
   * were skipped — never fails the sync itself (see scanWorktree below), but
   * a silent zero here would hide that some worktree's tasks are stale. */
  skippedWorktrees: number;
}

interface WorktreeScanAttempt {
  scan: WorktreeScan;
  failed: boolean;
}

/**
 * Scans one active worktree's copy of `tasksFolder`, alongside the paths it
 * has actually changed (see filesync/worktree-changes.ts — required so
 * filesync/merge.ts can tell "touched by this environment" apart from "this
 * full checkout just differs from main"). The scan itself never throws: an
 * environment that is mid-teardown, unreachable, or otherwise broken simply
 * contributes nothing, rather than failing the whole project's sync over one
 * stale worktree — `failed` reports that back so it isn't a silent zero.
 */
async function scanWorktree(
  bb: BbPluginApi,
  bbProjectId: string,
  tasksFolder: string,
  source: WorktreeSource,
): Promise<WorktreeScanAttempt> {
  const changedPaths = await changedFilePaths(bb, source.environmentId);
  try {
    const reader = createBbFileReader(bb, bbProjectId, source.environmentId);
    const scan = await scanTaskFolder(reader, tasksFolder, {
      kind: "worktree",
      environmentId: source.environmentId,
      name: source.name,
      branchName: source.branchName,
    });
    return { scan: { source, changedPaths, ...scan }, failed: false };
  } catch {
    return {
      scan: { source, changedPaths, files: [], invalid: [] },
      failed: true,
    };
  }
}

/**
 * Scans and reconciles every file-backed project (optionally one), reading
 * markdown from the linked BB project's main checkout plus every active
 * worktree (see filesync/worktrees.ts, filesync/merge.ts — a worktree's copy
 * of a file only takes over when that environment actually changed it and it
 * still diverges from main). The scan (I/O) runs outside the DB transaction;
 * each project's reconcile runs in its own transaction so one project's
 * failure cannot half-apply another's.
 */
export async function runFileSync(
  bb: BbPluginApi,
  store: TasksApiStore,
  options: { projectId?: string; dryRun?: boolean } = {},
): Promise<ProjectSyncResult[]> {
  const dryRun = options.dryRun ?? false;
  const projects = store.tasks
    .listSyncProjects()
    .filter((project) => !options.projectId || project.id === options.projectId);

  const results: ProjectSyncResult[] = [];
  for (const project of projects) {
    if (project.linkedBbProjectId === null || project.tasksFolder === null) {
      continue;
    }
    const bbProjectId = project.linkedBbProjectId;
    const tasksFolder = project.tasksFolder;

    const mainScan = await scanTaskFolder(
      createBbFileReader(bb, bbProjectId),
      tasksFolder,
    );
    const worktreeSources = await listActiveWorktreeSources(bb, bbProjectId);
    const worktreeAttempts = await Promise.all(
      worktreeSources.map((source) =>
        scanWorktree(bb, bbProjectId, tasksFolder, source),
      ),
    );
    const worktreeScans = worktreeAttempts.map((attempt) => attempt.scan);
    const skippedWorktrees = worktreeAttempts.filter(
      (attempt) => attempt.failed,
    ).length;

    const { files, invalid } = mergeFileScans(mainScan, worktreeScans);
    const invalidFilePaths = new Set(invalid.map((f) => f.filePath));
    // Dry run still reads through a transaction wrapper for a uniform call
    // shape, but syncProjectFiles performs no writes when dryRun is set, so
    // there is nothing for the transaction to commit or roll back.
    const summary = store.transaction(() =>
      syncProjectFiles(store.tasks, project, files, { dryRun, invalidFilePaths }),
    );
    results.push({
      projectId: project.id,
      prefix: project.prefix,
      tasksFolder,
      fileCount: files.length,
      ...summary,
      invalid,
      skippedWorktrees,
    });
  }
  return results;
}
