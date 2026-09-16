import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api/index.js";
import { publishProjectsChanged } from "../api/index.js";
import type { BoardConfig } from "../filesync/board-config.js";
import type { BoardRoot } from "../filesync/fs-boards.js";
import { resolveMainRoot } from "../filesync/resolve-roots.js";
import { defaultSourcePath } from "../filesync/resolve-roots.js";
import {
  foldersRpcContract,
  type FolderDomainError,
  type SyncedFolder,
} from "./contract.js";
import { deriveUniquePrefix } from "./prefix.js";

const DEFAULT_FOLDER_PROJECT_COLOR = "steelblue";
type SyncEligibleProject = BoardConfig & {
  tasksFolder: string;
  linkedBbProjectId: string;
};

function isSyncEligible(project: BoardConfig): project is SyncEligibleProject {
  return project.tasksFolder !== null && project.linkedBbProjectId !== null;
}

function domainError(error: FolderDomainError) {
  return { ok: false as const, error };
}

async function resolveBbProjectSourcePath(
  bb: BbPluginApi,
  bbProjectId: string,
): Promise<{ name: string | null; repoPath: string | null }> {
  try {
    const bbProject = await bb.sdk.projects.get({ projectId: bbProjectId });
    return { name: bbProject.name, repoPath: defaultSourcePath(bbProject.sources) };
  } catch {
    // Best-effort display data only — a stale/unreachable link still lists.
    return { name: null, repoPath: null };
  }
}

export function registerFolders(bb: BbPluginApi, store: TasksApiStore): void {
  /**
   * Доске принадлежит одна папка: главный чекаут её bb-проекта. Обхода
   * живых worktree здесь нет и не будет — он умножал каждое чтение задач на
   * число чекаутов (5 досок × 8 чекаутов × ~150 файлов ≈ 6000 чтений на
   * запрос, всё по одному репозиторию), и именно от этого доска вставала
   * (decisions/tasks-plus-board-roots-blocks-rpc.md).
   *
   * Дерево вызвавшего треда доске не принадлежит: оно принадлежит запросу и
   * резолвится точечно, по известному id окружения — см.
   * filesync/caller-scope.ts и filesync/resolve-roots.ts.
   *
   * Главный чекаут после подключения доски почти никогда не переезжает,
   * поэтому резолвится один раз на проект и хранится.
   */
  async function refreshRoots(project: SyncEligibleProject): Promise<void> {
    const mainRoot = await resolveMainRoot(
      bb,
      project.linkedBbProjectId,
      project.tasksFolder,
    );
    store.tasks.setBoardRoots(project.id, mainRoot ? [mainRoot] : []);
  }

  async function refreshAllRoots(): Promise<void> {
    const projects = store.tasks.listProjects().filter(isSyncEligible);
    await Promise.all(projects.map((project) => refreshRoots(project)));
  }

  async function buildSyncedFolderRow(
    project: SyncEligibleProject,
  ): Promise<SyncedFolder> {
    const bbProject = await resolveBbProjectSourcePath(bb, project.linkedBbProjectId);
    return {
      projectId: project.id,
      projectName: project.name,
      projectPrefix: project.prefix,
      taskCount: await store.projectTaskCount(project.id),
      tasksFolder: project.tasksFolder,
      linkedBbProjectId: project.linkedBbProjectId,
      linkedBbProjectName: bbProject.name,
      repoPath: bbProject.repoPath,
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
      const projects = store.tasks.listProjects().filter(isSyncEligible);
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
      await refreshRoots(resolved.project);
      return { ok: true, folder: await buildSyncedFolderRow(resolved.project) };
    },

    async removeSyncedFolder(input) {
      const project = store.tasks.getProject(input.projectId);
      if (!project) throw new Error(`Project not found: ${input.projectId}`);
      store.tasks.updateProject(project.id, { tasksFolder: null });
      store.tasks.setBoardRoots(project.id, []);
      publishProjectsChanged(bb, project.id);
      return { ok: true };
    },
  };

  bb.rpc.register(foldersRpcContract, handlers);

  // Resolve the main root of already-connected boards right after (re)load.
  // Nothing else re-resolves it: a board's checkout moves only when someone
  // edits the underlying bb project's sources, and that path already calls
  // refreshRoots itself.
  void refreshAllRoots().catch((error: unknown) =>
    bb.log.warn(
      `board-roots refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
}
