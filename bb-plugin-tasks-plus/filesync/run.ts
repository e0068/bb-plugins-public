import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api/index.js";
import { createBbFileReader } from "./bb-reader.js";
import { scanTaskFolder, type InvalidFile } from "./scan.js";
import { syncProjectFiles, type SyncSummary } from "./sync.js";

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
}

/**
 * Scans and reconciles every file-backed project (optionally one), reading
 * markdown from the linked BB project's workspace. The scan (I/O) runs outside
 * the DB transaction; each project's reconcile runs in its own transaction so
 * one project's failure cannot half-apply another's.
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
    const reader = createBbFileReader(bb, project.linkedBbProjectId);
    const { files, invalid } = await scanTaskFolder(reader, project.tasksFolder);
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
      tasksFolder: project.tasksFolder,
      fileCount: files.length,
      ...summary,
      invalid,
    });
  }
  return results;
}
