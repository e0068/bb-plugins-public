import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api/index.js";
import { attachmentsForTasks, publishProjectsChanged } from "../api/index.js";
import { removeAttachmentBlobs } from "../attachments/index.js";
import { runFileSync } from "../filesync/run.js";
import type { Project } from "../db/index.js";
import {
  foldersRpcContract,
  type FolderDomainError,
  type FolderSyncChangedEvent,
  type SyncedFolder,
} from "./contract.js";
import { deriveUniquePrefix } from "./prefix.js";
import { runFolderSync } from "./sync-runner.js";
import { FolderSyncStatusStore } from "./status-store.js";

const DEFAULT_FOLDER_PROJECT_COLOR = "steelblue";
const FOLDER_SYNC_INTERVAL_MS = 2 * 60_000;

type SyncEligibleProject = Project & {
  tasksFolder: string;
  linkedBbProjectId: string;
};

function isSyncEligible(project: Project): project is SyncEligibleProject {
  return project.tasksFolder !== null && project.linkedBbProjectId !== null;
}

function domainError(error: FolderDomainError) {
  return { ok: false as const, error };
}

function waitFor(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveBbProjectSourcePath(
  bb: BbPluginApi,
  bbProjectId: string,
): Promise<{ name: string | null; repoPath: string | null }> {
  try {
    const bbProject = await bb.sdk.projects.get({ projectId: bbProjectId });
    const source =
      bbProject.sources.find((entry) => entry.isDefault) ??
      bbProject.sources[0];
    return { name: bbProject.name, repoPath: source?.path ?? null };
  } catch {
    // Best-effort display data only — a stale/unreachable link still lists.
    return { name: null, repoPath: null };
  }
}

export function registerFolders(bb: BbPluginApi, store: TasksApiStore): void {
  const statusStore = new FolderSyncStatusStore(bb.storage.kv);
  const inFlight = new Map<string, Promise<void>>();

  function publishFolderSync(projectId: string): void {
    bb.realtime.publish("folderSync:changed", {
      projectId,
    } satisfies FolderSyncChangedEvent);
  }

  function syncFolder(projectId: string): Promise<void> {
    const existing = inFlight.get(projectId);
    if (existing) return existing;
    const run = runFolderSync(
      {
        runFileSync: (options) => runFileSync(bb, store, options),
        hasFileLinks: (id) => store.tasks.listFileTasks(id).length > 0,
        statusStore,
        publish: publishFolderSync,
      },
      projectId,
    ).finally(() => inFlight.delete(projectId));
    inFlight.set(projectId, run);
    return run;
  }

  async function buildSyncedFolderRow(
    project: SyncEligibleProject,
  ): Promise<SyncedFolder> {
    const [status, bbProject] = await Promise.all([
      statusStore.load(project.id),
      resolveBbProjectSourcePath(bb, project.linkedBbProjectId),
    ]);
    return {
      projectId: project.id,
      projectName: project.name,
      projectPrefix: project.prefix,
      taskCount: store.projectTaskCount(project.id),
      tasksFolder: project.tasksFolder,
      linkedBbProjectId: project.linkedBbProjectId,
      linkedBbProjectName: bbProject.name,
      repoPath: bbProject.repoPath,
      status,
    };
  }

  async function resolveOrCreateProject(
    bbProjectId: string,
    tasksFolder: string,
  ): Promise<
    { ok: true; project: SyncEligibleProject } | { ok: false; error: FolderDomainError }
  > {
    const existing = store.tasks
      .listProjects()
      .find((project) => project.linkedBbProjectId === bbProjectId);
    if (existing) {
      if (existing.tasksFolder !== null) {
        return domainError({
          code: "folder_already_connected",
          message: `"${existing.name}" is already connected to a synced folder (${existing.tasksFolder})`,
        });
      }
      const updated = store.tasks.updateProject(existing.id, { tasksFolder });
      if (!isSyncEligible(updated)) {
        return domainError({
          code: "folder_connect_failed",
          message: "Could not connect the folder",
        });
      }
      return { ok: true, project: updated };
    }

    let bbProject: Awaited<ReturnType<BbPluginApi["sdk"]["projects"]["get"]>>;
    try {
      bbProject = await bb.sdk.projects.get({ projectId: bbProjectId });
    } catch {
      return domainError({
        code: "bb_project_not_found",
        message: `bb project not found: ${bbProjectId}`,
      });
    }
    const taken = new Set(store.tasks.listProjects().map((p) => p.prefix));
    const prefix = deriveUniquePrefix(bbProject.name, taken);
    const created = store.tasks.createProject({
      name: bbProject.name,
      prefix,
      color: DEFAULT_FOLDER_PROJECT_COLOR,
      linkedBbProjectId: bbProjectId,
      tasksFolder,
    });
    if (!isSyncEligible(created)) {
      return domainError({
        code: "folder_connect_failed",
        message: "Could not connect the folder",
      });
    }
    return { ok: true, project: created };
  }

  const handlers: PluginRpcHandlers<typeof foldersRpcContract> = {
    async listSyncedFolders() {
      const projects = store.tasks.listSyncProjects().filter(isSyncEligible);
      const folders = await Promise.all(
        projects.map((project) => buildSyncedFolderRow(project)),
      );
      return { folders };
    },

    async listSyncableBbProjects() {
      const [bbProjects, taskProjects] = await Promise.all([
        bb.sdk.projects.list(),
        Promise.resolve(store.tasks.listProjects()),
      ]);
      const linkedIds = new Set(
        taskProjects
          .filter(isSyncEligible)
          .map((project) => project.linkedBbProjectId),
      );
      return {
        bbProjects: bbProjects
          .filter((project) =>
            project.sources.some((source) => source.type === "local_path"),
          )
          .map((project) => {
            const source =
              project.sources.find((entry) => entry.isDefault) ??
              project.sources.find((entry) => entry.type === "local_path");
            return {
              id: project.id,
              name: project.name,
              repoPath: source?.path ?? null,
              alreadyConnected: linkedIds.has(project.id),
            };
          }),
      };
    },

    async addSyncedFolder(input) {
      const resolved = await resolveOrCreateProject(
        input.bbProjectId,
        input.tasksFolder,
      );
      if (!resolved.ok) return resolved;
      publishProjectsChanged(bb, resolved.project.id);

      // Initial sync, run inline: the dialog waits for this so it can show
      // the result (or the error) immediately instead of a bare "connected".
      await syncFolder(resolved.project.id);

      const refreshed = store.tasks.getProject(resolved.project.id);
      if (!refreshed || !isSyncEligible(refreshed)) {
        return domainError({
          code: "folder_connect_failed",
          message: "The folder was disconnected before its first sync finished",
        });
      }
      return { ok: true, folder: await buildSyncedFolderRow(refreshed) };
    },

    async removeSyncedFolder(input) {
      const project = store.tasks.getProject(input.projectId);
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      let deletedTaskCount = 0;
      if (input.alsoDeleteTasks) {
        for (const fileTask of store.tasks.listFileTasks(project.id)) {
          const attachments = attachmentsForTasks(store.tasks, [
            fileTask.taskId,
          ]);
          const deleted = store.tasks.deleteTask(fileTask.taskId);
          if (deleted) {
            deletedTaskCount += 1;
            await removeAttachmentBlobs(bb, store.tasks, attachments);
          }
        }
      } else {
        store.tasks.clearFileTasksForProject(project.id);
      }

      store.tasks.updateProject(project.id, { tasksFolder: null });
      await statusStore.clear(project.id);

      publishProjectsChanged(bb, project.id);
      publishFolderSync(project.id);
      return { ok: true, deletedTaskCount };
    },

    async syncFolderNow(input) {
      const project = store.tasks.getProject(input.projectId);
      if (!project || !isSyncEligible(project)) return { folder: null };
      await syncFolder(project.id);
      const refreshed = store.tasks.getProject(project.id);
      if (!refreshed || !isSyncEligible(refreshed)) return { folder: null };
      return { folder: await buildSyncedFolderRow(refreshed) };
    },

    async syncAllFolders() {
      // Same catch-up the background loop and post-load bootstrap run, on
      // demand. syncFolder de-dupes per project, so a click that overlaps a
      // background tick coalesces onto the in-flight run instead of doubling.
      const projects = store.tasks.listSyncProjects();
      for (const project of projects) await syncFolder(project.id);
      return { synced: projects.length };
    },
  };

  bb.rpc.register(foldersRpcContract, handlers);

  bb.background.service("folder-sync", {
    async start(signal) {
      while (!signal.aborted) {
        await waitFor(signal, FOLDER_SYNC_INTERVAL_MS);
        if (signal.aborted) break;
        for (const project of store.tasks.listSyncProjects()) {
          if (signal.aborted) break;
          await syncFolder(project.id);
        }
      }
    },
  });

  // Catch up any already-connected folders right after (re)load, rather than
  // waiting up to FOLDER_SYNC_INTERVAL_MS for the first background tick.
  for (const project of store.tasks.listSyncProjects()) {
    void syncFolder(project.id);
  }
}
