import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api/index.js";
import { publishProjectsChanged, publishProjectTasksChanged } from "../api/index.js";
import type { BoardConfig } from "../filesync/board-config.js";
import { createDbRepo, type DbRepo } from "../filesync/db-repo.js";
import { resolveMainRoot } from "../filesync/resolve-roots.js";
import { defaultSourcePath } from "../filesync/resolve-roots.js";
import { DatabaseAuthFailed, DatabaseUnreachable, diskRepo } from "../filesync/task-repo.js";
import { createUlid } from "../filesync/validators.js";
import { createHranaClient, type HranaClient } from "../remote/hrana.js";
import { createTursoApi, databaseBaseName, type TursoApi, type TursoError, type TursoResult } from "../remote/turso.js";
import { mintCliApiToken, tursoCliCandidates } from "../remote/turso-cli.js";
import {
  foldersRpcContract,
  type FolderDomainError,
  type SyncedFolder,
} from "./contract.js";
import { databaseHost, parseDatabaseAddress } from "./database-address.js";
import { planConnect, sourceOf, tokenSource, usableToken, type ConnectPlan } from "./database-connect.js";
import { createDatabaseSecrets } from "./database-secrets.js";
import { deriveUniquePrefix } from "./prefix.js";

const DEFAULT_FOLDER_PROJECT_COLOR = "steelblue";
type SyncEligibleProject = BoardConfig & {
  tasksFolder: string;
  linkedBbProjectId: string;
};
type DatabaseBoard = BoardConfig & { database: { url: string } };

function isDatabaseBoard(project: BoardConfig): project is DatabaseBoard {
  return project.database != null;
}

/** A folder board: a database board keeps no folder, whatever else it holds. */
function isSyncEligible(project: BoardConfig): project is SyncEligibleProject {
  return !isDatabaseBoard(project) && project.tasksFolder !== null && project.linkedBbProjectId !== null;
}

function domainError(error: FolderDomainError) {
  return { ok: false as const, error };
}

/** One step of connecting: its value, or the refusal the dialog shows. */
type Step<T> = { ok: true; value: T } | { ok: false; error: FolderDomainError };

const proceed = <T>(value: T): Step<T> => ({ ok: true, value });

function tursoFailure(error: TursoError): FolderDomainError {
  switch (error.kind) {
    case "auth":
      return { code: "turso_api_failed", message: "Turso refused the API token." };
    case "unreachable":
      return { code: "turso_api_failed", message: "Turso cannot be reached." };
    case "name_taken":
      return { code: "turso_api_failed", message: "Turso has no free name for this database." };
    case "api":
      return { code: "turso_api_failed", message: error.message };
  }
}

function fromTurso<T>(result: TursoResult<T>): Step<T> {
  return result.ok ? proceed(result.value) : { ok: false, error: tursoFailure(result.error) };
}

/** What a failed open, sync or write of a database means to the dialog. */
function databaseFailure(error: unknown): FolderDomainError {
  if (error instanceof DatabaseUnreachable) return { code: "database_unreachable", message: "The database cannot be reached." };
  if (error instanceof DatabaseAuthFailed) return { code: "database_auth_failed", message: "The database refused the token." };
  return { code: "folder_connect_failed", message: error instanceof Error ? error.message : String(error) };
}

const refusal = (message: string, code: FolderDomainError["code"] = "folder_connect_failed"): Step<never> => ({
  ok: false,
  error: { code, message },
});


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

/** Keys that more than one task carries, case aside — a database holds each key once. */
function duplicateKeys(keys: readonly (string | null)[]): string[] {
  const counts = keys
    .filter((key): key is string => key !== null)
    .map((key) => key.toUpperCase())
    .reduce((acc, key) => acc.set(key, (acc.get(key) ?? 0) + 1), new Map<string, number>());
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key).sort();
}

export function registerFolders(bb: BbPluginApi, store: TasksApiStore): void {
  const secrets = createDatabaseSecrets(bb);
  /** The open repository of each database board, by board id. */
  const repos = new Map<string, DbRepo>();

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
      source: { kind: "folder" },
    };
  }

  function buildDatabaseRow(board: DatabaseBoard): SyncedFolder {
    const repo = repos.get(board.id);
    const at = new Date().toISOString();
    return {
      projectId: board.id,
      projectName: board.name,
      projectPrefix: board.prefix,
      taskCount: repo?.count() ?? 0,
      tasksFolder: null,
      linkedBbProjectId: null,
      linkedBbProjectName: null,
      repoPath: null,
      // A board whose repository could not be opened (no saved token) is unreachable, and says so.
      source: sourceOf(board.database.url, repo?.state() ?? { kind: "offline", since: at, lastSyncAt: null }, at),
    };
  }

  async function buildRow(board: BoardConfig): Promise<SyncedFolder | null> {
    if (isDatabaseBoard(board)) return buildDatabaseRow(board);
    return isSyncEligible(board) ? buildSyncedFolderRow(board) : null;
  }

  // ------------------------------------------------------------ Databases

  /**
   * A repository for a database board over the given client. The board's id
   * is known before the board exists, so a change or a link that moves is
   * told to the interface under it from the first poll on.
   */
  function openRepo(boardId: string, url: string, client: HranaClient): DbRepo {
    return createDbRepo(client, {
      url,
      onChange: () => publishProjectTasksChanged(bb, boardId),
      onStateChange: () => publishProjectsChanged(bb, boardId),
    });
  }

  /**
   * A client whose token is read from the saved ones on first use. Reading
   * it is asynchronous, and a board must have its repository the moment the
   * plugin has loaded — the lifecycle reads every board right then — so the
   * repository is made at once and the token comes when the first request
   * needs it. No saved token is a refused one.
   */
  function savedTokenClient(url: string): HranaClient {
    let opened: HranaClient | null = null;
    const client = async (): Promise<HranaClient | null> => {
      if (opened !== null) return opened;
      const token = await secrets.databaseToken(url).catch(() => null);
      opened = token === null ? null : createHranaClient({ url, token });
      return opened;
    };
    const refused = { ok: false, error: { kind: "auth" } } as const;
    return {
      url,
      execute: async (sql, args) => (await client())?.execute(sql, args) ?? refused,
      batch: async (steps) => (await client())?.batch(steps) ?? refused,
    };
  }

  /** Stops a repository and takes it out of both the service and the store — the undo of attachRepo. */
  function detachRepo(boardId: string): void {
    repos.get(boardId)?.stop();
    repos.delete(boardId);
    store.tasks.removeBoardRepo(boardId);
  }

  /** Hands the repository to the store and starts its poll. */
  function attachRepo(boardId: string, repo: DbRepo): void {
    repos.set(boardId, repo);
    store.tasks.setBoardRepo(boardId, repo);
    repo.start();
  }

  /** Opens a connected board's database with the token saved for it. */
  function openConnectedBoard(board: DatabaseBoard): void {
    const repo = openRepo(board.id, board.database.url, savedTokenClient(board.database.url));
    attachRepo(board.id, repo);
    void syncQuietly(repo);
  }

  /** A sync whose failure is the link's business, not an error. */
  async function syncQuietly(repo: DbRepo): Promise<void> {
    try {
      await repo.sync();
    } catch (error) {
      if (error instanceof DatabaseUnreachable || error instanceof DatabaseAuthFailed) return;
      bb.log.warn(`tasks-plus: syncing a board database failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function tursoApi(typed?: string | null): Promise<Step<{ api: TursoApi; token: string }>> {
    const token = usableToken(typed) ?? (await secrets.tursoApiToken());
    return token === null
      ? refusal("Enter a Turso API token first.", "turso_token_required")
      : proceed({ api: createTursoApi({ token }), token });
  }

  /** A token for a database of the account, made by Turso. */
  async function mintDatabaseToken(url: string): Promise<Step<string>> {
    const account = await tursoApi();
    if (!account.ok) return account;
    const { api } = account.value;
    const org = fromTurso(await api.organization());
    if (!org.ok) return org;
    const listed = fromTurso(await api.listDatabases(org.value));
    if (!listed.ok) return listed;
    const found = listed.value.find((database) => databaseHost(database.url) === databaseHost(url));
    if (found === undefined) return refusal("The Turso account has no database at this address.", "turso_api_failed");
    return fromTurso(await api.mintToken(org.value, found.name));
  }

  async function tokenFor(input: { token?: string }, address: { url: string; token: string | null }): Promise<Step<string>> {
    const source = tokenSource(input, address, await secrets.databaseToken(address.url));
    return source.kind === "given" ? proceed(source.token) : mintDatabaseToken(address.url);
  }

  async function createDatabaseFor(prefix: string, typed: string | undefined): Promise<Step<string>> {
    const name = prefix.trim();
    if (name === "") return refusal("Give the board a prefix before creating its database.");
    const account = await tursoApi(typed);
    if (!account.ok) return account;
    const { api, token: accountToken } = account.value;
    const org = fromTurso(await api.organization());
    if (!org.ok) return org;
    // The account accepted the token: it is kept for the next time.
    if (usableToken(typed) !== null && accountToken !== (await secrets.tursoApiToken())) await secrets.saveTursoApiToken(accountToken);
    const group = fromTurso(await api.ensureGroup(org.value));
    if (!group.ok) return group;
    const created = fromTurso(await api.createDatabase(org.value, databaseBaseName(name), group.value));
    if (!created.ok) return created;
    const minted = fromTurso(await api.mintToken(org.value, created.value.name));
    if (!minted.ok) return minted;
    await secrets.saveDatabaseToken(created.value.url, minted.value);
    return proceed(created.value.url);
  }

  /** The folder board asked to move, or the refusal of moving a board that is not one. */
  function folderBoardToMove(boardId: string | undefined): Step<SyncEligibleProject | null> {
    if (boardId === undefined) return proceed(null);
    const board = store.tasks.getProject(boardId);
    return board !== undefined && isSyncEligible(board) ? proceed(board) : refusal("The board to move is not a connected folder.");
  }

  /**
   * Writes every task of the folder into the database under the text of its
   * file. A write that fails takes back the ones before it: a database left
   * half filled would refuse the next attempt as not empty.
   */
  async function copyFolderTasks(board: SyncEligibleProject, target: DbRepo): Promise<Step<null>> {
    const root = await resolveMainRoot(bb, board.linkedBbProjectId, board.tasksFolder);
    if (root === null) return refusal("The folder of this board cannot be found.");
    const source = diskRepo(root.absPath);
    const files = await source.list();
    const doubled = duplicateKeys(files.map((file) => file.task.key ?? null));
    if (doubled.length > 0) return refusal(`Two tasks of this folder share a key (${doubled.join(", ")}) — give one of each a new key, then move the board.`);
    const written = await Promise.allSettled(
      files.map(async (file) =>
        (
          await target.write({
            status: file.status,
            slug: file.slug,
            placement: { assignee: file.assignee, epic: file.epic },
            content: await source.readText(file.filePath),
            times: { createdAt: file.createdAt, updatedAt: file.updatedAt },
          })
        ).filePath,
      ),
    );
    const failure = written.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure === undefined) return proceed(null);
    await Promise.allSettled(written.flatMap((result) => (result.status === "fulfilled" ? [target.remove(result.value)] : [])));
    return { ok: false, error: databaseFailure(failure.reason) };
  }

  /** Puts the board of the plan in place, in the database and in the store. */
  async function applyPlan(plan: Exclude<ConnectPlan, { kind: "refuse" }>, boardId: string, url: string, repo: DbRepo): Promise<Step<null>> {
    switch (plan.kind) {
      case "move": {
        const board = store.tasks.getProject(plan.boardId);
        if (board === undefined || !isSyncEligible(board)) return refusal("The board to move is not a connected folder.");
        const copied = await copyFolderTasks(board, repo);
        if (!copied.ok) return copied;
        await repo.writeBoard({ name: plan.name, prefix: plan.prefix });
        attachRepo(boardId, repo);
        store.tasks.updateProject(boardId, { database: { url }, tasksFolder: null });
        store.tasks.setBoardRoots(boardId, []);
        return proceed(null);
      }
      case "adopt":
      case "fresh": {
        if (plan.kind === "fresh") await repo.writeBoard({ name: plan.name, prefix: plan.prefix });
        attachRepo(boardId, repo);
        store.tasks.createProject({ id: boardId, name: plan.name, prefix: plan.prefix, color: DEFAULT_FOLDER_PROJECT_COLOR, database: { url } });
        return proceed(null);
      }
    }
  }

  /** What in the store stands in the way of a new board at this address and prefix. */
  function collision(plan: ConnectPlan, url: string): string | null {
    if (plan.kind === "refuse" || plan.kind === "move") return null;
    if (store.tasks.listProjects().some((board) => board.database?.url === url)) return "A board is already connected to this database.";
    return store.projectPrefixExists(plan.prefix, "") ? `The prefix ${plan.prefix} is already used by another board.` : null;
  }

  async function connect(input: { url: string; token?: string; moveFromBoardId?: string; name?: string; prefix?: string }): Promise<Step<null>> {
    const address = parseDatabaseAddress(input.url);
    if (!address.ok) return refusal(address.message);
    const token = await tokenFor(input, address);
    if (!token.ok) return token;
    const moveFrom = folderBoardToMove(input.moveFromBoardId);
    if (!moveFrom.ok) return moveFrom;

    const boardId = moveFrom.value?.id ?? createUlid();
    const repo = openRepo(boardId, address.url, createHranaClient({ url: address.url, token: token.value }));
    try {
      await repo.sync();
    } catch (error) {
      return { ok: false, error: databaseFailure(error) };
    }
    const plan = planConnect(
      {
        moveFrom: moveFrom.value === null ? null : { id: moveFrom.value.id, name: moveFrom.value.name, prefix: moveFrom.value.prefix },
        name: input.name,
        prefix: input.prefix,
      },
      { board: await repo.readBoard(), taskCount: repo.count() },
    );
    if (plan.kind === "refuse") return refusal(plan.message, plan.code);
    const blocked = collision(plan, address.url);
    if (blocked !== null) return refusal(blocked);
    let applied: Step<null>;
    try {
      applied = await applyPlan(plan, boardId, address.url, repo);
    } catch (error) {
      repo.stop();
      detachRepo(boardId);
      return { ok: false, error: databaseFailure(error) };
    }
    if (!applied.ok) {
      repo.stop();
      detachRepo(boardId);
      return applied;
    }
    await secrets.saveDatabaseToken(address.url, token.value);
    publishProjectsChanged(bb, boardId);
    publishProjectTasksChanged(bb, boardId);
    return proceed(null);
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
      if (isDatabaseBoard(existing)) {
        return domainError({
          code: "folder_already_connected",
          message: `"${existing.name}" lives in a database (${existing.database?.url ?? ""}) and takes no folder`,
        });
      }
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
      const rows = await Promise.all(store.tasks.listProjects().map(buildRow));
      return { folders: rows.filter((row): row is SyncedFolder => row !== null) };
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

    async createDatabase(input) {
      const created = await createDatabaseFor(input.prefix, input.tursoApiToken);
      return created.ok ? { ok: true, url: created.value } : created;
    },

    async listTursoDatabases() {
      const account = await tursoApi();
      if (!account.ok) return account;
      const org = fromTurso(await account.value.api.organization());
      if (!org.ok) return org;
      const listed = fromTurso(await account.value.api.listDatabases(org.value));
      return listed.ok ? { ok: true, databases: listed.value } : listed;
    },

    async connectDatabase(input) {
      const connected = await connect(input);
      return connected.ok ? { ok: true } : connected;
    },

    generateTursoApiToken: () => mintCliApiToken({ execFile, candidates: tursoCliCandidates(homedir()), now: new Date() }),

    async hasTursoApiToken() {
      return { saved: (await secrets.tursoApiToken()) !== null };
    },

    async retryDatabase(input) {
      const repo = repos.get(input.boardId);
      if (repo !== undefined) await syncQuietly(repo);
      return { ok: true };
    },
  };

  bb.rpc.register(foldersRpcContract, handlers);

  bb.onDispose(() => {
    repos.forEach((repo) => repo.stop());
    repos.clear();
  });

  // Every connected board gets its repository right after (re)load.
  store.tasks.listProjects().filter(isDatabaseBoard).forEach(openConnectedBoard);

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
