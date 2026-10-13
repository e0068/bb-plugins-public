import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api/index.js";
import { publishProjectsChanged, publishProjectTasksChanged } from "../api/index.js";
import { createFolderMirror, mirrorDirectory, type FolderMirror } from "../filesync/folder-mirror.js";
import { linkTakenBy, linkTakenMessage, type BoardConfig } from "../filesync/board-config.js";
import { createDbRepo, failureOf, peekBoard, type DbRepo } from "../filesync/db-repo.js";
import { newTableId, type DbTable, type TableId } from "../filesync/db-tables.js";
import { CHOICE_TYPES, declaredField, fieldProblem, optionProblem } from "../shared/section-fields.js";
import { resolveMainRoot } from "../filesync/resolve-roots.js";
import { defaultSourcePath } from "../filesync/resolve-roots.js";
import { DatabaseAuthFailed, DatabaseTokenMissing, DatabaseUnreachable, diskRepo, outOfReach } from "../filesync/task-repo.js";
import { createUlid } from "../filesync/validators.js";
import { createHranaClient, unreachableSentence, type HranaClient, type UnreachableCause } from "../remote/hrana.js";
import { createTursoApi, databaseBaseName, type TursoApi, type TursoError, type TursoResult } from "../remote/turso.js";
import { mintCliApiToken, tursoCliCandidates } from "../remote/turso-cli.js";
import {
  foldersRpcContract,
  type ConnectDatabaseInput,
  type FolderDomainError,
  type InspectDatabaseResult,
  type ProjectRow,
  type ProjectRowBoard,
  type SyncedFolder,
  type SyncedSource,
} from "./contract.js";
import { databaseHost, databaseInvite, parseDatabaseAddress } from "./database-address.js";
import { planConnect, sourceOf, tokenSource, usableToken, type ConnectPlan } from "./database-connect.js";
import { createDatabaseSecrets } from "./database-secrets.js";
import { deriveUniquePrefix } from "./prefix.js";
import { holdsProject, projectRows, type RowBbProject } from "./project-rows.js";

const DEFAULT_FOLDER_PROJECT_COLOR = "steelblue";
/** What a database created before its board has a prefix is named after. */
const UNNAMED_DATABASE = "board";
type SyncEligibleProject = BoardConfig & {
  tasksFolder: string;
  linkedBbProjectId: string;
};
type DatabaseBoard = BoardConfig & { database: { url: string } };
/** A board that shows a table beside the task board of its database. */
type TableBoard = BoardConfig & { database: { url: string; table: TableId } };

function isDatabaseBoard(project: BoardConfig): project is DatabaseBoard {
  return project.database != null;
}

function isTableBoard(project: BoardConfig): project is TableBoard {
  return project.database?.table !== undefined;
}

/** The name of a table's folder in its task board's mirror: no separators, no leading dots. */
function tableFolderName(tableName: string): string {
  const name = tableName.replace(/[/\\:]/g, "-").replace(/^\.+/, "").trim();
  return name === "" ? "section" : name;
}

/** A table's mirror: the subfolder named after it in its task board's mirror folder. */
export function tableMirrorFolder(taskBoardFolder: string, tableName: string): string {
  return `${taskBoardFolder.replace(/\/+$/, "")}/${tableFolderName(tableName)}`;
}

/** Two table names that would share a mirror folder — on macOS a folder's name ignores case. */
const sameFolder = (a: string, b: string): boolean => tableFolderName(a).toLowerCase() === tableFolderName(b).toLowerCase();

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

/** Where the account token came from: typed in the dialog, or saved from before. */
type TokenOrigin = "typed" | "saved";

const REFUSED_TOKEN: Record<TokenOrigin, string> = {
  typed: "Turso refused this API token.",
  saved: "Turso refused the saved API token.",
};

function tursoFailure(error: TursoError, origin: TokenOrigin): FolderDomainError {
  switch (error.kind) {
    case "auth":
      return { code: "turso_token_refused", message: REFUSED_TOKEN[origin] };
    case "unreachable":
      return { code: "turso_api_failed", message: "Turso cannot be reached." };
    case "timeout":
      return { code: "turso_api_failed", message: `Turso did not answer in ${Math.round(error.ms / 1000)} s — try again. If it made the database meanwhile, pick it from the list.` };
    case "name_taken":
      return { code: "turso_api_failed", message: "Turso has no free name for this database." };
    case "api":
      return { code: "turso_api_failed", message: error.message };
  }
}

function fromTurso<T>(result: TursoResult<T>, origin: TokenOrigin): Step<T> {
  return result.ok ? proceed(result.value) : { ok: false, error: tursoFailure(result.error, origin) };
}

/** What a failed open, sync or write of a database means to the dialog. */
function databaseFailure(error: unknown): FolderDomainError {
  if (error instanceof DatabaseUnreachable) return { code: "database_unreachable", message: error.message };
  if (error instanceof DatabaseAuthFailed) return { code: "database_auth_failed", message: "The database refused the token." };
  if (error instanceof DatabaseTokenMissing) return { code: "database_token_missing", message: "No token for this database is saved on this machine." };
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

/** The checkout a bb project keeps on this machine: its default source of the local-path kind, none for a project without one. */
function localRepoPath(sources: Parameters<typeof defaultSourcePath>[0]): string | null {
  return defaultSourcePath(sources.filter((source) => source.type === "local_path"));
}

/** Everything one database connection is put together from, past the plan. */
type ConnectTarget = { boardId: string; url: string; repo: DbRepo; bbProjectId: string | null };

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
  /** The folder mirror of each database board that has one, by board id. */
  const mirrors = new Map<string, FolderMirror>();

  /** Brings a board's mirror folder up to its records. A board without one is
   *  left, and so is one whose database has not answered yet: an empty mirror
   *  before the first poll would take every file of the folder away. */
  function mirrorBoard(boardId: string): void {
    const mirror = mirrors.get(boardId);
    const repo = repos.get(boardId);
    if (mirror === undefined || repo === undefined || !repo.loaded()) return;
    void mirror.sync(repo.snapshot()).catch((error: unknown) =>
      bb.log.warn(`tasks-plus: mirroring the board into ${mirror.dir} failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  /** The task board of a database: the board on its address that shows no table. */
  function taskBoardOf(url: string): DatabaseBoard | undefined {
    return store.tasks.listProjects().filter(isDatabaseBoard).find((board) => board.database.url === url && !isTableBoard(board));
  }

  /** The boards of the tables beside a database's task board. */
  function tableBoardsOf(url: string): TableBoard[] {
    return store.tasks.listProjects().filter(isTableBoard).filter((board) => board.database.url === url);
  }

  /** The folder a board mirrors into: its own setting, or a section's subfolder of its parent's folder. */
  function mirrorSetting(board: BoardConfig): string | null {
    if (!isDatabaseBoard(board)) return null;
    if (!isTableBoard(board)) return board.database.mirrorFolder || null;
    return sectionFolder(board, tableBoardsOf(board.database.url).length);
  }

  /** A section's folder: inside its parent section's, or the task board's for a top one. The chain is walked
   *  at most once per section, so a loop in the data ends on the task board's folder instead of hanging. */
  function sectionFolder(section: TableBoard, hops: number): string | null {
    const { url, parent } = section.database;
    const above = hops > 0 && parent !== undefined ? tableBoardsOf(url).find((board) => board.database.table === parent) : undefined;
    const base = above === undefined ? taskBoardOf(url)?.database.mirrorFolder || null : sectionFolder(above, hops - 1);
    return base ? tableMirrorFolder(base, section.name) : null;
  }

  /** Opens, moves or closes a board's mirror to match its setting. */
  function placeMirror(board: BoardConfig): void {
    const setting = mirrorSetting(board);
    const dir = setting === null ? null : mirrorDirectory(setting);
    if (dir === null) return void mirrors.delete(board.id);
    // One folder, one board: a second mirror would take the first one's files for its own and remove them.
    const holder = [...mirrors].find(([boardId, mirror]) => boardId !== board.id && mirror.dir.toLowerCase() === dir.toLowerCase());
    if (holder !== undefined) {
      mirrors.delete(board.id);
      return void bb.log.warn(`tasks-plus: ${board.name} is not mirrored: ${dir} is already the mirror of another board`);
    }
    if (mirrors.get(board.id)?.dir !== dir) mirrors.set(board.id, createFolderMirror(dir, (message) => bb.log.warn(message)));
    mirrorBoard(board.id);
  }

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

  function databaseTaskCount(board: DatabaseBoard): number {
    return repos.get(board.id)?.count() ?? 0;
  }

  function databaseSource(board: DatabaseBoard): SyncedSource {
    const at = new Date().toISOString();
    // A board with no repository open yet is unreachable, and says so.
    return sourceOf(board.database.url, repos.get(board.id)?.state() ?? { kind: "offline", since: at, lastSyncAt: null }, at);
  }

  function buildDatabaseRow(board: DatabaseBoard): SyncedFolder {
    return {
      projectId: board.id,
      projectName: board.name,
      projectPrefix: board.prefix,
      taskCount: databaseTaskCount(board),
      tasksFolder: null,
      linkedBbProjectId: null,
      linkedBbProjectName: null,
      repoPath: null,
      source: databaseSource(board),
    };
  }

  async function buildRow(board: BoardConfig): Promise<SyncedFolder | null> {
    if (isDatabaseBoard(board)) return buildDatabaseRow(board);
    return isSyncEligible(board) ? buildSyncedFolderRow(board) : null;
  }

  // --------------------------------------------------------- Projects tab

  /** bb's projects, the personal one included, as the tab's rows know them. */
  async function listBbProjects(): Promise<RowBbProject[]> {
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    return projects.map((project) => ({ id: project.id, name: project.name, repoPath: localRepoPath(project.sources) }));
  }

  /** The board as a row shows it — counted and sourced the way listSyncedFolders does. */
  async function buildProjectRowBoard(board: BoardConfig): Promise<ProjectRowBoard> {
    const shown = {
      id: board.id,
      name: board.name,
      prefix: board.prefix,
      color: board.color,
      ...(board.icon === undefined ? {} : { icon: board.icon }),
      tasksFolder: board.tasksFolder,
    };
    const mirrorFolder = isDatabaseBoard(board) ? board.database.mirrorFolder ?? null : null;
    return isDatabaseBoard(board)
      ? { ...shown, taskCount: databaseTaskCount(board), source: databaseSource(board), ...(mirrorFolder === null ? {} : { mirrorFolder }) }
      : { ...shown, taskCount: await store.projectTaskCount(board.id), source: { kind: "folder" } };
  }

  /** The boards the Projects tab lays out: a table sits under its task board, not in a row of its own. */
  function rowBoards(): BoardConfig[] {
    return store.tasks.listProjects().filter((board) => !isTableBoard(board));
  }

  /** A board in a row wears its bb project's name: a project renamed in bb renames its board here. */
  function renameBoardsLike(bbProjects: readonly RowBbProject[]): void {
    projectRows(bbProjects, rowBoards()).renames.forEach(({ boardId, name }) => {
      store.tasks.updateProject(boardId, { name });
      publishProjectsChanged(bb, boardId);
    });
  }

  async function listProjectRows(): Promise<{ projects: ProjectRow[]; orphans: ProjectRowBoard[] }> {
    const bbProjects = await listBbProjects();
    renameBoardsLike(bbProjects);
    const rows = projectRows(bbProjects, rowBoards());
    return {
      projects: await Promise.all(
        rows.projects.map(async ({ bbProject, board }): Promise<ProjectRow> => ({
          bbProject,
          board: board === null ? null : await buildProjectRowBoard(board),
        })),
      ),
      orphans: await Promise.all(rows.orphans.map(buildProjectRowBoard)),
    };
  }

  // ------------------------------------------------------------ Databases

  /** The one line the bb log gets about a database that stopped answering: the sentence the dialog shows and the address, never the token. */
  function warnUnreachable(url: string, why: UnreachableCause): void {
    bb.log.warn(`tasks-plus: ${unreachableSentence(why)} (${url})`);
  }

  /**
   * A repository for a database board over the given client. The board's id
   * is known before the board exists, so a change or a link that moves is
   * told to the interface under it from the first poll on.
   */
  function openRepo(boardId: string, url: string, client: HranaClient, table?: TableId): DbRepo {
    const repo = createDbRepo(client, {
      url,
      ...(table === undefined ? {} : { table }),
      onLinkLost: (why) => warnUnreachable(url, why),
      onChange: () => {
        publishProjectTasksChanged(bb, boardId);
        void adoptPrefix(boardId, repo);
        mirrorBoard(boardId);
        if (table === undefined) syncTables(boardId);
      },
      onWrite: () => mirrorBoard(boardId),
      onStateChange: () => publishProjectsChanged(bb, boardId),
    });
    return repo;
  }

  /**
   * Takes the prefix another machine gave the database's board. The name
   * stays this machine's own: it is shown here only. A board not created yet
   * — a connection under way — takes the database's prefix as it is created.
   * A prefix another board of this machine has is not taken: two boards with
   * one prefix would share their keys, and a key would open either.
   */
  async function adoptPrefix(boardId: string, repo: DbRepo): Promise<void> {
    const kept = await repo.readBoard().catch(() => null);
    const board = store.tasks.getProject(boardId);
    if (kept === null || board === undefined || kept.prefix === "" || kept.prefix === board.prefix) return;
    if (store.projectPrefixExists(kept.prefix, boardId)) return;
    store.tasks.updateProject(boardId, { prefix: kept.prefix });
    publishProjectsChanged(bb, boardId);
  }

  /**
   * A client whose token is read from the saved ones on first use. Reading
   * it is asynchronous, and a board must have its repository the moment the
   * plugin has loaded — the lifecycle reads every board right then — so the
   * repository is made at once and the token comes when the first request
   * needs it. No saved token is no token, not a refusal: nothing is sent,
   * and the next request reads the saved ones again.
   */
  function savedTokenClient(url: string): HranaClient {
    let opened: HranaClient | null = null;
    const client = async (): Promise<HranaClient | null> => {
      if (opened !== null) return opened;
      const token = await secrets.databaseToken(url).catch(() => null);
      opened = token === null ? null : createHranaClient({ url, token });
      return opened;
    };
    const tokenless = { ok: false, error: { kind: "no-token" } } as const;
    return {
      url,
      execute: async (sql, args) => (await client())?.execute(sql, args) ?? tokenless,
      batch: async (steps) => (await client())?.batch(steps) ?? tokenless,
    };
  }

  /** Stops a repository and takes it out of both the service and the store — the undo of attachRepo. */
  function detachRepo(boardId: string): void {
    repos.get(boardId)?.stop();
    repos.delete(boardId);
    mirrors.delete(boardId);
    store.tasks.removeBoardRepo(boardId);
  }

  /** Hands the repository to the store and starts its poll. */
  function attachRepo(boardId: string, repo: DbRepo): void {
    repos.set(boardId, repo);
    store.tasks.setBoardRepo(boardId, repo);
    // A board taken off its repository and given another keeps its mirror.
    const board = store.tasks.getProject(boardId);
    if (board !== undefined) placeMirror(board);
    repo.start();
  }

  /** Opens a connected board's database with the token saved for it. */
  function openConnectedBoard(board: DatabaseBoard): void {
    const repo = openRepo(board.id, board.database.url, savedTokenClient(board.database.url), board.database.table);
    attachRepo(board.id, repo);
    void syncQuietly(repo);
  }

  /**
   * Gives every table of a task board's database a board on this machine: a
   * table another machine added shows up here on the poll that brings it.
   * Answers the boards it made.
   */
  function syncTables(taskBoardId: string): TableBoard[] {
    const taskBoard = store.tasks.getProject(taskBoardId);
    const repo = repos.get(taskBoardId);
    if (taskBoard === undefined || !isDatabaseBoard(taskBoard) || isTableBoard(taskBoard) || repo === undefined) return [];
    const url = taskBoard.database.url;
    const known = new Set(tableBoardsOf(url).map((board) => board.database.table));
    const made = repo
      .tables()
      .filter((table) => !known.has(table.id))
      .map((table) => {
        const taken = new Set(store.tasks.listProjects().map((board) => board.prefix));
        const board = store.tasks.createProject({
          name: table.name,
          prefix: deriveUniquePrefix(table.name, taken),
          color: taskBoard.color,
          linkedBbProjectId: null,
          database: sectionDatabase({ url }, table),
        }) as TableBoard;
        openConnectedBoard(board);
        return board;
      });
    const changed = repo.tables().flatMap((table) => {
      const board = tableBoardsOf(url).find((known) => known.database.table === table.id);
      if (board === undefined) return [];
      // A renamed section's folder takes its new name, as a moved one's goes under its new parent.
      const moved = (board.database.parent ?? null) !== table.parent || board.name !== table.name;
      const retyped = JSON.stringify(board.database.fields ?? []) !== JSON.stringify(table.fields);
      return moved || retyped
        ? [{ board: store.tasks.updateProject(board.id, { name: table.name, database: sectionDatabase(board.database, table) }), moved }]
        : [];
    });
    // Before the database first answers the list is empty, not the sections gone.
    const listed = new Set(repo.tables().map((table) => table.id));
    const gone = repo.loaded() ? tableBoardsOf(url).filter((board) => !listed.has(board.database.table)) : [];
    gone.forEach((board) => {
      detachRepo(board.id);
      store.tasks.deleteProject(board.id);
    });
    // A section that moved takes its folder, and the folders of the sections inside it, along.
    if (changed.some((change) => change.moved)) tableBoardsOf(url).forEach(placeMirror);
    if (made.length > 0 || changed.length > 0 || gone.length > 0) publishProjectsChanged(bb, taskBoardId);
    return made;
  }

  /** A section's board with the task board of its database and that board's repository, which keeps the list of sections. */
  function sectionRepo(boardId: string): { ok: true; section: TableBoard; taskBoard: DatabaseBoard; repo: DbRepo } | { ok: false; message: string } {
    const section = store.tasks.getProject(boardId);
    const taskBoard = section !== undefined && isTableBoard(section) ? taskBoardOf(section.database.url) : undefined;
    const repo = taskBoard === undefined ? undefined : repos.get(taskBoard.id);
    if (section === undefined || !isTableBoard(section) || taskBoard === undefined || repo === undefined) {
      return { ok: false, message: "Only a section of a project's database can do that." };
    }
    return { ok: true, section, taskBoard, repo };
  }

  /** A section's board as its database names it: its parent and its fields — a board an older plugin made has neither. */
  function sectionDatabase(database: { url: string; mirrorFolder?: string | null }, table: DbTable): NonNullable<BoardConfig["database"]> {
    const { url, mirrorFolder } = database;
    return {
      url,
      ...(mirrorFolder === undefined ? {} : { mirrorFolder }),
      table: table.id,
      ...(table.parent === null ? {} : { parent: table.parent }),
      ...(table.fields.length === 0 ? {} : { fields: table.fields }),
    };
  }

  /** A folder board leaves Tasks+ with its roots; its task files stay where they are. */
  function removeFolderBoard(board: BoardConfig): void {
    store.tasks.setBoardRoots(board.id, []);
    store.tasks.deleteProject(board.id);
  }

  /** A database board leaves this machine with its token and its tables; the database and its records stay for the others. */
  async function disconnectDatabase(board: DatabaseBoard): Promise<void> {
    await secrets.forgetDatabaseToken(board.database.url);
    [board, ...tableBoardsOf(board.database.url)].forEach((left) => {
      detachRepo(left.id);
      store.tasks.deleteProject(left.id);
    });
  }

  /** A sync whose failure is the link's business, not an error. */
  async function syncQuietly(repo: DbRepo): Promise<void> {
    try {
      await repo.sync();
    } catch (error) {
      if (outOfReach(error)) return;
      bb.log.warn(`tasks-plus: syncing a board database failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The Turso account the typed token opens, else the saved one. A typed
   * token the account accepts takes the saved one's place.
   */
  async function openAccount(typed?: string): Promise<Step<{ api: TursoApi; org: string; origin: TokenOrigin }>> {
    const given = usableToken(typed);
    const token = given ?? (await secrets.tursoApiToken());
    if (token === null) return refusal("Enter a Turso API token first.", "turso_token_required");
    const origin: TokenOrigin = given === null ? "saved" : "typed";
    const api = createTursoApi({ token });
    const org = fromTurso(await api.organization(), origin);
    if (!org.ok) return org;
    if (given !== null && given !== (await secrets.tursoApiToken())) await secrets.saveTursoApiToken(given);
    return proceed({ api, org: org.value, origin });
  }

  /** A token for a database of the account, made by Turso. */
  async function mintDatabaseToken(url: string, typed: string | undefined): Promise<Step<string>> {
    const account = await openAccount(typed);
    if (!account.ok) return account;
    const { api, org, origin } = account.value;
    const listed = fromTurso(await api.listDatabases(org), origin);
    if (!listed.ok) return listed;
    const found = listed.value.find((database) => databaseHost(database.url) === databaseHost(url));
    if (found === undefined) return refusal("The Turso account has no database at this address.", "turso_api_failed");
    return fromTurso(await api.mintToken(org, found.name), origin);
  }

  /** The token saved for the address — none when a board is connected to it: that board's token is
   *  the one being replaced, and handing it back would only be refused again. */
  async function savedTokenFor(url: string): Promise<string | null> {
    return store.tasks.listProjects().some((board) => board.database?.url === url) ? null : secrets.databaseToken(url);
  }

  async function tokenFor(input: { token?: string; tursoApiToken?: string }, address: { url: string; token: string | null }): Promise<Step<string>> {
    const source = tokenSource(input, address, await savedTokenFor(address.url));
    return source.kind === "given" ? proceed(source.token) : mintDatabaseToken(address.url, input.tursoApiToken);
  }

  /** A new database, named after the board's prefix when it is known yet. */
  async function createDatabaseFor(prefix: string | undefined, typed: string | undefined): Promise<Step<string>> {
    const name = prefix?.trim() || UNNAMED_DATABASE;
    const account = await openAccount(typed);
    if (!account.ok) return account;
    const { api, org, origin } = account.value;
    const group = fromTurso(await api.ensureGroup(org), origin);
    if (!group.ok) return group;
    const created = fromTurso(await api.createDatabase(org, databaseBaseName(name), group.value), origin);
    if (!created.ok) return created;
    const minted = fromTurso(await api.mintToken(org, created.value.name), origin);
    if (!minted.ok) return minted;
    await secrets.saveDatabaseToken(created.value.url, minted.value);
    return proceed(created.value.url);
  }

  /** The folder board asked to copy, or the refusal of copying a board that is not one. */
  function folderBoardToCopy(boardId: string | undefined): Step<SyncEligibleProject | null> {
    if (boardId === undefined) return proceed(null);
    const board = store.tasks.getProject(boardId);
    return board !== undefined && isSyncEligible(board) ? proceed(board) : refusal("The board to copy is not a connected folder.");
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
    if (doubled.length > 0) return refusal(`Two tasks of this folder share a key (${doubled.join(", ")}) — give one of each a new key, then copy the board.`);
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

  /** A board linked to the project with no folder and no database does not hold it: the new board takes the project from it. */
  function releaseProject(bbProjectId: string | null): void {
    store.tasks
      .listProjects()
      .filter((board) => bbProjectId !== null && board.linkedBbProjectId === bbProjectId && !holdsProject(board))
      .forEach((board) => store.tasks.updateProject(board.id, { linkedBbProjectId: null }));
  }

  /** The board of a connected database, on the bb project it was connected from when there is one. */
  function createDatabaseBoard(plan: { name: string; prefix: string }, target: ConnectTarget): void {
    releaseProject(target.bbProjectId);
    store.tasks.createProject({
      id: target.boardId,
      name: plan.name,
      prefix: plan.prefix,
      color: DEFAULT_FOLDER_PROJECT_COLOR,
      linkedBbProjectId: target.bbProjectId,
      database: { url: target.url },
    });
  }

  /** Puts the board of the plan in place, in the database and in the store. */
  async function applyPlan(plan: Exclude<ConnectPlan, { kind: "refuse" }>, target: ConnectTarget): Promise<Step<null>> {
    switch (plan.kind) {
      case "copy": {
        const source = store.tasks.getProject(plan.sourceId);
        if (source === undefined || !isSyncEligible(source)) return refusal("The board to copy is not a connected folder.");
        const copied = await copyFolderTasks(source, target.repo);
        if (!copied.ok) return copied;
        await target.repo.writeBoard({ name: plan.name, prefix: plan.prefix });
        attachRepo(target.boardId, target.repo);
        // The copy takes the project's row from the folder board it came from: one board per bb project.
        if (target.bbProjectId !== null && source.linkedBbProjectId === target.bbProjectId) store.tasks.updateProject(source.id, { linkedBbProjectId: null });
        createDatabaseBoard(plan, target);
        return proceed(null);
      }
      case "adopt":
      case "fresh": {
        if (plan.kind === "fresh") await target.repo.writeBoard({ name: plan.name, prefix: plan.prefix });
        attachRepo(target.boardId, target.repo);
        createDatabaseBoard(plan, target);
        return proceed(null);
      }
    }
  }

  /**
   * The refusal of a bb project another board holds. The folder board a copy comes from gives up
   * the project's row to the copy, and a board with no source never held it.
   */
  function projectTaken(bbProjectId: string, copiedBoardId: string | undefined): string | null {
    const holder = linkTakenBy(store.tasks.listProjects().filter(holdsProject), bbProjectId, copiedBoardId);
    return holder === undefined ? null : linkTakenMessage(bbProjectId, holder);
  }

  /**
   * What in the store stands in the way of a new board at this address and
   * prefix. A copy shares its prefix with the folder board it came from: the
   * keys of the copied tasks carry it. A connected address gets here only to
   * be copied into; otherwise it takes the token instead (`replaceToken`). A
   * bb project another board holds is not taken a second time.
   */
  function collision(plan: ConnectPlan, url: string, bbProjectId: string | null): string | null {
    if (plan.kind === "refuse") return null;
    if (store.tasks.listProjects().some((board) => board.database?.url === url)) return "A board is already connected to this database.";
    const source = plan.kind === "copy" ? plan.sourceId : "";
    const taken = bbProjectId === null ? null : projectTaken(bbProjectId, plan.kind === "copy" ? plan.sourceId : undefined);
    if (taken !== null) return taken;
    return store.projectPrefixExists(plan.prefix, source) ? `The key prefix ${plan.prefix} is already used by another board.` : null;
  }

  /**
   * The board a database holds, read before connecting it. A token Turso
   * mints for the reading is kept, as connecting would keep it, so the next
   * reading mints none; a token the person typed is kept only by connecting.
   */
  async function inspect(input: { url: string; token?: string; tursoApiToken?: string }): Promise<InspectDatabaseResult> {
    const address = parseDatabaseAddress(input.url);
    if (!address.ok) return { ok: false, error: { code: "folder_connect_failed", message: address.message } };
    const source = tokenSource(input, address, await savedTokenFor(address.url));
    const token = source.kind === "given" ? proceed(source.token) : await mintDatabaseToken(address.url, input.tursoApiToken);
    if (!token.ok) return token;
    const peeked = await peekBoard(createHranaClient({ url: address.url, token: token.value }));
    if (!peeked.ok) {
      if (peeked.error.kind === "unreachable") warnUnreachable(address.url, peeked.error.why);
      return { ok: false, error: databaseFailure(failureOf(peeked.error)) };
    }
    if (source.kind === "mint") await secrets.saveDatabaseToken(address.url, token.value);
    return { ok: true, board: peeked.value };
  }

  /**
   * A board already connected to the address takes the token in place of its
   * own — the way back from a token revoked or expired. The board keeps its
   * id, and with it its history; a token the database refuses changes nothing.
   */
  async function replaceToken(board: DatabaseBoard, token: string): Promise<Step<null>> {
    const repo = openRepo(board.id, board.database.url, createHranaClient({ url: board.database.url, token }));
    try {
      await repo.sync();
    } catch (error) {
      return { ok: false, error: databaseFailure(error) };
    }
    await secrets.saveDatabaseToken(board.database.url, token);
    detachRepo(board.id);
    attachRepo(board.id, repo);
    publishProjectsChanged(bb, board.id);
    publishProjectTasksChanged(bb, board.id);
    return proceed(null);
  }

  /** The bb project a database is connected from, or the refusal when bb has none by that id; none asked for is none. */
  async function bbProjectOf(bbProjectId: string | undefined): Promise<Step<{ id: string; name: string } | null>> {
    if (bbProjectId === undefined) return proceed(null);
    try {
      const { id, name } = await bb.sdk.projects.get({ projectId: bbProjectId });
      return proceed({ id, name });
    } catch {
      return refusal(`bb project not found: ${bbProjectId}`, "bb_project_not_found");
    }
  }

  async function connect(input: ConnectDatabaseInput): Promise<Step<null>> {
    const address = parseDatabaseAddress(input.url);
    if (!address.ok) return refusal(address.message);
    const token = await tokenFor(input, address);
    if (!token.ok) return token;
    const connected = store.tasks.listProjects().filter(isDatabaseBoard).find((board) => board.database.url === address.url);
    if (connected !== undefined && input.copyFromBoardId === undefined) return replaceToken(connected, token.value);
    const copyFrom = folderBoardToCopy(input.copyFromBoardId);
    if (!copyFrom.ok) return copyFrom;
    const project = await bbProjectOf(input.bbProjectId);
    if (!project.ok) return project;

    const boardId = createUlid();
    const repo = openRepo(boardId, address.url, createHranaClient({ url: address.url, token: token.value }));
    try {
      await repo.sync();
    } catch (error) {
      return { ok: false, error: databaseFailure(error) };
    }
    const plan = planConnect(
      {
        copyFrom: copyFrom.value === null ? null : { id: copyFrom.value.id, name: copyFrom.value.name, prefix: copyFrom.value.prefix },
        // On a bb project the board is named after the project, so the dialog sends no name.
        name: input.name ?? project.value?.name,
        prefix: input.prefix,
      },
      { board: await repo.readBoard(), taskCount: repo.count() },
    );
    if (plan.kind === "refuse") return refusal(plan.message, plan.code);
    const bbProjectId = project.value?.id ?? null;
    const blocked = collision(plan, address.url, bbProjectId);
    if (blocked !== null) return refusal(blocked);
    // On a bb project the board is named after the project, whatever name came with the plan.
    const named = project.value === null ? plan : { ...plan, name: project.value.name };
    let applied: Step<null>;
    try {
      applied = await applyPlan(named, { boardId, url: address.url, repo, bbProjectId });
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
      const rows = await Promise.all(rowBoards().map(buildRow));
      return { folders: rows.filter((row): row is SyncedFolder => row !== null) };
    },

    listProjectRows,

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
      // A table is listed in its database: taken off this machine alone, the next poll would bring it back.
      if (isTableBoard(project)) throw new Error("A table leaves together with its project's database.");
      if (isDatabaseBoard(project)) await disconnectDatabase(project);
      else removeFolderBoard(project);
      publishProjectsChanged(bb, project.id);
      return { ok: true };
    },

    async databaseInvite(input) {
      const board = store.tasks.getProject(input.boardId);
      if (board === undefined || !isDatabaseBoard(board)) return domainError({ code: "folder_connect_failed", message: "This board is not kept in a database." });
      const token = await secrets.databaseToken(board.database.url);
      if (token === null) return domainError({ code: "folder_connect_failed", message: "No token is saved for this database." });
      return { ok: true, invite: databaseInvite(board.database.url, token) };
    },

    async setMirrorFolder(input) {
      const board = store.tasks.getProject(input.boardId);
      if (board === undefined || !isDatabaseBoard(board)) return { ok: false, message: "Only a board kept in a database has a mirror folder." };
      if (isTableBoard(board)) return { ok: false, message: "A section mirrors into a folder inside its parent's mirror folder." };
      const setting = input.folder?.trim() ?? "";
      const dir = setting === "" ? null : mirrorDirectory(setting);
      if (setting !== "" && dir === null) return { ok: false, message: "The mirror folder must be a full path, or start with ~/." };
      // One folder, one board: a second board would take the first one's files for its own and remove them.
      const holder = [...mirrors].find(([boardId, mirror]) => boardId !== board.id && mirror.dir === dir);
      if (holder !== undefined) return { ok: false, message: `${store.tasks.getProject(holder[0])?.name ?? "Another board"} already mirrors into this folder.` };
      const updated = store.tasks.updateProject(board.id, { database: { ...board.database, mirrorFolder: setting === "" ? null : setting } });
      placeMirror(updated);
      tableBoardsOf(board.database.url).forEach(placeMirror);
      publishProjectsChanged(bb, board.id);
      return { ok: true, folder: setting === "" ? null : setting };
    },

    async createTable(input) {
      // The board the "+" was pressed on: the task board for a top section, a section for one inside it.
      const holder = store.tasks.getProject(input.boardId);
      const taskBoard = holder !== undefined && isDatabaseBoard(holder) ? taskBoardOf(holder.database.url) : undefined;
      const repo = taskBoard === undefined ? undefined : repos.get(taskBoard.id);
      if (holder === undefined || taskBoard === undefined || repo === undefined) {
        return { ok: false, message: "Only a project kept in a database can hold sections." };
      }
      const parent = isTableBoard(holder) ? holder.database.table : null;
      const name = input.name.trim();
      const taken = repo.tables().find((table) => table.parent === parent && sameFolder(table.name, name));
      if (taken !== undefined) return { ok: false, message: `${holder.name} already has the section ${taken.name}.` };
      let table;
      try {
        table = await repo.addTable(newTableId(Math.random), name, parent);
      } catch (error) {
        return { ok: false, message: databaseFailure(error).message };
      }
      syncTables(taskBoard.id);
      const board = tableBoardsOf(taskBoard.database.url).find((made) => made.database.table === table.id);
      const tableRepo = board === undefined ? undefined : repos.get(board.id);
      if (board === undefined || tableRepo === undefined) return { ok: false, message: "The section was added, but its board could not be opened." };
      // The prefix goes into the table's own head, so the other machines take the same one; until it lands they derive their own.
      await tableRepo
        .sync()
        .then(() => tableRepo.writeBoard({ name: board.name, prefix: board.prefix }))
        .catch((error: unknown) => bb.log.warn(`tasks-plus: the prefix of table ${board.name} is not in its database yet: ${databaseFailure(error).message}`));
      return { ok: true, boardId: board.id };
    },

    async addSectionField(input) {
      const found = sectionRepo(input.boardId);
      if (!found.ok) return found;
      const { section, taskBoard, repo } = found;
      const declared = repo.tables().find((table) => table.id === section.database.table)?.fields ?? [];
      const problem = fieldProblem(declared, input.name);
      if (problem !== null) return { ok: false, message: problem };
      try {
        await repo.addTableField(section.database.table, { name: input.name, type: input.type });
      } catch (error) {
        return { ok: false, message: databaseFailure(error).message };
      }
      syncTables(taskBoard.id);
      return { ok: true };
    },

    async changeFieldOption(input) {
      const found = sectionRepo(input.boardId);
      if (!found.ok) return found;
      const { section, taskBoard, repo } = found;
      const declared = repo.tables().find((table) => table.id === section.database.table)?.fields ?? [];
      const field = declaredField(declared, input.field);
      if (field === undefined || !CHOICE_TYPES.has(field.type)) return { ok: false, message: "Only a Select or Tags property has options." };
      const listed = declared.some((own) => own.name.toLowerCase() === field.name.toLowerCase());
      if (input.change === "add") {
        const problem = optionProblem(field.options ?? [], input.option);
        if (problem !== null) return { ok: false, message: problem };
      }
      // An option the list never named is no option to take away.
      if (input.change === "remove" && !listed) return { ok: true };
      try {
        // A default field gets into the list with its first option; a listed one takes it inside the database.
        if (listed) await repo.changeFieldOption(section.database.table, field.name, input.option, input.change);
        else await repo.addTableField(section.database.table, { name: field.name, type: field.type, options: [input.option] });
      } catch (error) {
        return { ok: false, message: databaseFailure(error).message };
      }
      syncTables(taskBoard.id);
      return { ok: true };
    },

    async renameSection(input) {
      const found = sectionRepo(input.boardId);
      if (!found.ok) return found;
      const { section, taskBoard, repo } = found;
      const name = input.name.trim();
      const parent = section.database.parent ?? null;
      const taken = repo.tables().find((table) => table.id !== section.database.table && table.parent === parent && sameFolder(table.name, name));
      if (taken !== undefined) return { ok: false, message: `There is already a section ${taken.name} here.` };
      try {
        await repo.renameTable(section.database.table, name);
      } catch (error) {
        return { ok: false, message: databaseFailure(error).message };
      }
      syncTables(taskBoard.id);
      // The table's own head names it too; a machine that reads it before the list catches up sees the new name all the same.
      await repos
        .get(section.id)
        ?.writeBoard({ name, prefix: section.prefix })
        .catch((error: unknown) => bb.log.warn(`tasks-plus: the head of section ${name} keeps its old name: ${databaseFailure(error).message}`));
      return { ok: true };
    },

    async deleteSection(input) {
      const found = sectionRepo(input.boardId);
      if (!found.ok) return found;
      const { section, taskBoard, repo } = found;
      try {
        await repo.deleteTable(section.database.table);
      } catch (error) {
        return { ok: false, message: databaseFailure(error).message };
      }
      syncTables(taskBoard.id);
      return { ok: true };
    },

    async createDatabase(input) {
      const created = await createDatabaseFor(input.prefix, input.tursoApiToken);
      return created.ok ? { ok: true, url: created.value } : created;
    },

    async listTursoDatabases() {
      const account = await openAccount();
      if (!account.ok) return account;
      const { api, org, origin } = account.value;
      const listed = fromTurso(await api.listDatabases(org), origin);
      return listed.ok ? { ok: true, databases: listed.value } : listed;
    },

    inspectDatabase: inspect,

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
    mirrors.clear();
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

  // A bb project renamed while Tasks+ was off renames its board at load, not
  // only when the tab is next opened. With no board on a bb project there is
  // nothing to rename and bb is not asked; bb's refusal is no reason to stop.
  if (store.tasks.listProjects().some((board) => board.linkedBbProjectId !== null)) {
    void listBbProjects().then(renameBoardsLike).catch((error: unknown) =>
      bb.log.warn(`board-names sync failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
