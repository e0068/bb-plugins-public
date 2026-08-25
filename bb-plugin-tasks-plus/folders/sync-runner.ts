import type { ProjectSyncResult } from "../filesync/run.js";
import type { FolderSyncStatusStore } from "./status-store.js";

export interface FolderSyncRunnerDeps {
  /** Thin wrapper over filesync/run.ts's runFileSync bound to (bb, store) —
   * injected so this orchestration is testable without real I/O. */
  runFileSync: (options: {
    projectId: string;
    dryRun?: boolean;
  }) => Promise<ProjectSyncResult[]>;
  /** True when the project already has tasks linked through file_tasks. */
  hasFileLinks: (projectId: string) => boolean;
  statusStore: FolderSyncStatusStore;
  /** Notify listeners (realtime) that this project's status changed. */
  publish: (projectId: string) => void;
  now?: () => string;
}

/**
 * Runs (or refuses to run) one folder's file sync, updating its persisted
 * status throughout. Never throws — a failure is recorded as an "error"
 * status, not propagated, so callers (the background loop, the manual
 * button, the connect flow) never need their own try/catch.
 *
 * Deletion safety: `runFileSync`'s deletion pass (filesync/sync.ts) only
 * fires once files are read successfully — a thrown scan error (folder
 * missing, project unreachable) short-circuits before it runs, so nothing is
 * deleted on a read failure. The remaining risk is a *successful* scan that
 * comes back empty for a folder that already has linked tasks (temporarily
 * unmounted path, wrong tasksFolder, a branch checkout mid-flight): the
 * engine cannot tell that apart from "every file was legitimately removed".
 * This runner closes that gap with a cheap dry-run preview: an empty result
 * against a project with existing links is treated as an error instead of a
 * real (deleting) run.
 */
export async function runFolderSync(
  deps: FolderSyncRunnerDeps,
  projectId: string,
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  deps.statusStore.setSyncing(projectId);
  deps.publish(projectId);
  try {
    if (deps.hasFileLinks(projectId)) {
      const [preview] = await deps.runFileSync({ projectId, dryRun: true });
      // A folder that is empty of *valid* files but still has INVALID ones
      // is not the "scan came back empty" case this guard exists for — the
      // files are there, just unreadable, and deletion is already protected
      // by invalidFilePaths (filesync/sync.ts). Only refuse when there is
      // truly nothing, valid or not.
      if (preview && preview.fileCount === 0 && preview.invalid.length === 0) {
        throw new Error(
          "Folder scan returned no files while the board still has linked tasks — refusing to sync (check the path and repository access)",
        );
      }
    }

    const [result] = await deps.runFileSync({ projectId });
    if (!result) {
      // Disconnected concurrently (tasksFolder cleared) — nothing to report.
      await deps.statusStore.clear(projectId);
      return;
    }
    await deps.statusStore.setSynced(
      projectId,
      {
        created: result.created,
        updated: result.updated,
        adopted: result.adopted,
        deleted: result.deleted,
        invalid: result.invalid.length,
      },
      result.invalid.map((f) => ({ path: f.filePath, reason: f.reason })),
      now(),
    );
  } catch (error) {
    await deps.statusStore.setError(
      projectId,
      error instanceof Error ? error.message : String(error),
      now(),
    );
  } finally {
    deps.publish(projectId);
  }
}
