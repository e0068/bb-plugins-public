import type {
  FileTaskOrigin,
  CreateAttachmentInput,
  CreateCommentInput,
  CreateLabelInput,
  CreatePresetInput,
  CreateSavedViewInput,
  CreateTaskInput,
  Folder,
  ListTasksFilters,
  Preset,
  SavedView,
  SubtaskDoneCounts,
  UpdateAttachmentInput,
  UpdateCommentInput,
  UpdateLabelInput,
  UpdatePresetInput,
  UpdateTaskInput,
  UpsertTaskThreadInput,
  Attachment,
} from "../db/types.js";
import type { Comment, Label, Task, TaskCardMeta, TaskThread } from "../shared/contract.js";
import { claimOnWrite, type ClaimRequest, type ClaimState, type TakenBy } from "../shared/task-claim.js";
import {
  readBoardConfigs,
  writeBoardConfigs,
  upsertBoardConfig,
  removeBoardConfig,
  nextTaskNumber,
  type BoardConfig,
  type KvStore,
} from "./board-config.js";
import { createBoardRepos } from "./board-repos.js";
import { retryOnConflict } from "./write-retry.js";
import { outOfReach, unlessOutOfReach, type RepoFile, type TaskRepo } from "./task-repo.js";
import { loadKvCollection, createKvCollection } from "./kv-collection.js";
import { migrateSavedView } from "./saved-view-migrate.js";
import { applyPatch } from "./patch.js";
import { onePerSlug, readBoardTaskFiles, type BoardRoot } from "./fs-boards.js";
import { createParseCache } from "./parse-cache.js";
import { createOrderStore, loadTaskOrders, type TaskOrders } from "./order-store.js";
import { applyOrder, moveInOrder, type OrderNeighbors } from "../shared/manual-order.js";
import { createSerialByKey } from "./serial-by-key.js";
import { callerWorktreeRoot, requestRoots, type CallerEnvironment } from "./caller-root.js";
import { rootOfTaskFile, writeTaskFile } from "./fs-repo.js";
import { nextPlacement, NO_PLACEMENT, type TaskPlacement } from "./placement.js";
import { planMigration } from "./epic-migrate.js";
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { assembleBoardTasks, parseTaskKey, taskSlug, type AssembledTask } from "./assemble.js";
import { rekeyBoard, rewriteMentions } from "./prefix-rename.js";
import { issueKeys } from "./key-issue.js";
import {
  serializeAttachedThread,
  withLiveState,
  type AttachedThread,
  type ThreadLiveState,
} from "../threads/live-state.js";
import { AMOUNT_KEYS, renderTaskFile } from "./task-file.js";
import { parseFrontmatter } from "./frontmatter.js";
import { AMOUNT_FIELDS } from "../shared/amounts.js";
import { filterTasks } from "./query.js";
import { uniqueSlug, validateSlug } from "./slug.js";
import { byLiveStatusFirst, parseTaskCursor, taskPage, type TaskPage } from "./task-page.js";
import { TASKS_PAGE_DEFAULT_LIMIT } from "../shared/pagination.js";
import { createOrValidateUlid, requireNonEmpty, validateDueDate,
  validateStartDate, validateDollars, validateMinutes, validateThreadId } from "./validators.js";


/** A thread whose agent is currently starting or working — the Active view. */
function isActiveThread(thread: TaskThread): boolean {
  return thread.liveStatus === "starting" || thread.liveStatus === "working";
}

/** An idle, non-archived thread — the Waiting view (see client/data.ts). */
function isWaitingThread(thread: TaskThread): boolean {
  return thread.liveStatus === "idle" && thread.archivedAt === null;
}

/** An assembled task as the store serves it: the file's attachment facts
 *  with each thread's current state laid over them. */
interface BoardTask extends Omit<AssembledTask, "threads"> {
  threads: TaskThread[];
}

/** IDs of tasks with at least one thread matching `matches`, from an
 *  already-loaded pool — no extra file reads. */
function taskIdsWithThread(
  pool: readonly BoardTask[],
  matches: (thread: TaskThread) => boolean,
): Set<string> {
  const ids = new Set<string>();
  for (const t of pool) {
    if (t.threads.some(matches)) ids.add(t.task.id);
  }
  return ids;
}

/** A file-backed project (formerly a projects table row) + a folder (UI
 *  grouping, formerly its own table) are the same generic kv-collection
 *  shape; boards are their own type because create/update carry extra
 *  invariants (prefix format, unique per-board). */
export interface FolderRecord extends Folder {}

/** Removes `dir` when nothing but empty folders is left in it — what moving
 *  an epic folder's files out leaves behind. A file anywhere keeps it. */
async function removeIfEmpty(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) return false;
  const emptied = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? removeIfEmpty(join(dir, entry.name)) : Promise.resolve(false))),
  );
  if (!emptied.every(Boolean)) return false;
  await rmdir(dir);
  return true;
}

/** One epic folder as `migrateEpics` left it, or would: `key` is null for an epic a dry run has yet to make. */
export interface MigratedEpic {
  key: string | null;
  name: string;
  assignee: string;
  tasks: number;
}

/** A task in progress or in review that another machine holds cannot be taken. */
export class TaskAlreadyTaken extends Error {
  constructor(
    readonly key: string,
    readonly takenBy: TakenBy,
  ) {
    super(`${key} is already taken on ${takenBy.machine}`);
    this.name = "TaskAlreadyTaken";
  }
}

/** The mark a write leaves on a task, or the refusal to take it. */
function claimedTakenBy(current: ClaimState & { key: string }, request: ClaimRequest, machine: string): TakenBy | null {
  const outcome = claimOnWrite(current, request, machine, new Date());
  if (!outcome.ok) throw new TaskAlreadyTaken(current.key, outcome.takenBy);
  return outcome.takenBy;
}

/** A task's `source`: the file it was read from or written to, and for a database its row version. */
function taskSource(origin: FileTaskOrigin, filePath: string, revision: number | null | undefined): NonNullable<Task["source"]> {
  return revision === null || revision === undefined ? { filePath, origin } : { filePath, origin, revision };
}

export function createFileTasksStore(
  kv: KvStore,
  boards: BoardConfig[],
  folders: Folder[],
  presets: Preset[],
  savedViews: SavedView[],
  onError: (error: unknown) => void,
  /** Из какого дерева пришёл текущий вызов. Читается на каждый запрос, а не
   *  запоминается: через процесс идут команды разных тредов сразу
   *  (filesync/caller-scope.ts). Интерфейс доски своего дерева не имеет —
   *  отсюда null, и он остаётся на main. */
  readCallerEnvironment: () => CallerEnvironment | null = () => null,
  /** Each board's manual order, as `loadTaskOrders` read it from the KV. */
  taskOrders: TaskOrders = {},
  /** The name this machine stamps on the tasks it takes. */
  machineName = "local",
) {
  let boardConfigs = boards;
  /** The repository of each board that lives in a database, set by whoever connects it. */
  const boardRepos = createBoardRepos();
  const roots = new Map<string, BoardRoot[]>();
  /** Where each attached bb thread is right now, keyed by bb thread id
   *  (state belongs to the thread, not to one of the tasks it is attached
   *  to). Process memory on purpose: it changes every few minutes and
   *  writing it into the task file turned every status flip into a commit —
   *  see docs/decisions/tasks-plus-thread-state-is-not-a-file-field.md.
   *  Filled by lifecycle/index.ts from bb's own thread events. */
  const liveStates = new Map<string, ThreadLiveState>();
  /** Выдача имени задаче — «прочитать номера доски и записать файл» — идёт по
   *  одной на доску: два одновременных запроса иначе прочитали бы один и тот
   *  же наибольший номер и выдали бы двум задачам один ключ. */
  const serialByBoard = createSerialByKey();
  const folderCol = createKvCollection<Folder>(kv, "folders", folders, onError);
  const presetCol = createKvCollection<Preset>(kv, "presets", presets, onError);
  const viewCol = createKvCollection<SavedView>(kv, "savedViews", savedViews, onError);
  const orders = createOrderStore(kv, taskOrders, onError);
  /** One parse per changed file, shared by every read of every board. */
  const parseCache = createParseCache();
  /** Board reads under way, so requests arriving together share one. */
  const reading = new Map<string, { writes: number; tasks: Promise<BoardTask[]> }>();
  /** Bumped by every write of this store: a request that comes after a
   *  write must not be answered by a read that started before it. */
  let writes = 0;

  function persistBoards(): void {
    writeBoardConfigs(kv, boardConfigs).catch(onError);
  }

  /** Sets the resolved absolute checkout path a board reads from: its
   *  project's main checkout. Populated by an external, asynchronous
   *  service — see decisions/tasks-files-are-the-store.md — because
   *  resolving it requires bb.sdk calls. Дерево вызывающего треда сюда не
   *  попадает: оно принадлежит запросу, а не доске. */
  function setBoardRoots(boardId: string, next: BoardRoot[]): void {
    roots.set(boardId, next);
  }

  /** Sets the repository a database board reads and writes. */
  function setBoardRepo(boardId: string, repo: TaskRepo): void {
    boardRepos.set(boardId, repo);
  }

  /** Takes a database board's repository back — a connection rolled back. */
  function removeBoardRepo(boardId: string): void {
    boardRepos.remove(boardId);
  }

  /** Where a database board's tasks live, as a root: the address, never a path. */
  function databaseRoot(board: BoardConfig): BoardRoot {
    return { absPath: board.database?.url ?? "", origin: { kind: "database", url: board.database?.url ?? "" } };
  }

  /** Runs a write that reads before it writes; when another machine's write
   *  got in between, catches up with the databases and runs it again from a
   *  fresh read (filesync/write-retry.ts). A folder never conflicts. */
  function retrying<T>(run: () => Promise<T>): Promise<T> {
    return retryOnConflict(run, syncDatabases);
  }

  /** Catches up with every database; one that cannot be reached does not stop
   *  the others — the retried write meets its own board's failure itself. */
  async function syncDatabases(): Promise<void> {
    await Promise.allSettled(boardConfigs.map(async (board) => boardRepos.repoFor(board)?.sync()));
  }

  function requireBoard(id: string): BoardConfig {
    const board = boardConfigs.find((b) => b.id === id);
    if (!board) throw new Error(`Project not found: ${id}`);
    return board;
  }

  /** Throws rather than falling back to an empty path — a silent fallback
   *  would make a write land in the server process's cwd instead of the
   *  board's actual folder. A board with no roots set means `setBoardRoots`
   *  hasn't run yet for it (see decisions/tasks-files-are-the-store.md). */
  function boardMainRoot(board: BoardConfig): BoardRoot {
    const boardRoots = roots.get(board.id) ?? [];
    const root = boardRoots.find((r) => r.origin.kind === "main") ?? boardRoots[0];
    if (!root) {
      throw new Error(
        `Board ${board.id} has no resolved checkout path yet (setBoardRoots not called) — cannot write a task file`,
      );
    }
    return root;
  }

  /** Папки одного запроса: main доски и дерево вызвавшего треда. */
  function boardRequestRoots(board: BoardConfig): BoardRoot[] {
    return requestRoots(
      roots.get(board.id) ?? [],
      callerWorktreeRoot(board, readCallerEnvironment()),
    );
  }

  /** The root a task's file lives in — прочитанный из самого пути файла
   *  (`rootOfTaskFile`), а не подобранный из списка корней: так правка не
   *  может уехать в main оттого, что дерево задачи в этот список не попало.
   *  An edit follows its file: a task created in a worktree stays there and
   *  never gets a second copy in main — two copies of one slug are exactly
   *  what makes the merge of that branch into main a conflict. */
  function rootOfTask(board: BoardConfig, task: Task): BoardRoot {
    if (board.database) return databaseRoot(board);
    const source = task.source;
    if (!source) return boardMainRoot(board);
    return { absPath: rootOfTaskFile(source.filePath, placementOf(task)), origin: source.origin };
  }

  /** Where the task's file sits above its status folder, as read. */
  function placementOf(task: Task): TaskPlacement {
    return { assignee: task.assignee ?? null, epic: task.epic ?? null };
  }

  /** Where a new task goes: дерево создавшего её треда (файл уезжает в main
   *  вместе с веткой), иначе main — доска, открытая из bb, пишет в main. */
  function rootForNewTask(board: BoardConfig): BoardRoot {
    if (board.database) return databaseRoot(board);
    return callerWorktreeRoot(board, readCallerEnvironment()) ?? boardMainRoot(board);
  }

  /** Every request looks at the board's files fresh — see
   *  decisions/tasks-files-are-the-store.md — but requests that arrive
   *  together, with no write of this store between them, share one read,
   *  and a file is parsed again only when it changed (filesync/parse-cache.ts).
   *  Async (node:fs/promises) so a read does not block the plugin's single
   *  event loop while it waits on disk — see
   *  decisions/tasks-plus-board-roots-blocks-rpc.md. */
  function loadBoard(board: BoardConfig): Promise<BoardTask[]> {
    const roots = board.database ? [] : boardRequestRoots(board);
    const key = [board.id, ...roots.map((root) => root.absPath)].join("\0");
    const current = reading.get(key);
    if (current?.writes === writes) return current.tasks;
    const entry = { writes, tasks: readBoard(board, roots) };
    reading.set(key, entry);
    const settle = () => {
      if (reading.get(key) === entry) reading.delete(key);
    };
    entry.tasks.then(settle, settle);
    return entry.tasks;
  }

  /** The board's tasks in its manual order, `position` counting from the top. */
  async function readBoard(board: BoardConfig, roots: readonly BoardRoot[]): Promise<BoardTask[]> {
    const repo = boardRepos.repoFor(board);
    const assembled = repo
      ? await readDatabaseBoard(board, repo)
      : assembleBoardTasks({ id: board.id }, onePerSlug(await readBoardTaskFiles(roots, parseCache))).tasks;
    const byId = new Map(assembled.map((entry) => [entry.task.id, entry]));
    return applyOrder(assembled.map((entry) => entry.task), orders.get(board.id)).map((task, position) => {
      const entry = byId.get(task.id)!;
      return {
        ...entry,
        task: { ...task, position },
        threads: entry.threads.map((thread) => withLiveState(thread, liveStates.get(thread.threadId))),
      };
    });
  }

  /** A database board is read from its repository's mirror, whatever tree the
   *  caller sits in; each task carries the row version it was read at. */
  async function readDatabaseBoard(board: BoardConfig, repo: TaskRepo): Promise<AssembledTask[]> {
    const origin: FileTaskOrigin = { kind: "database", url: board.database?.url ?? "" };
    const files: RepoFile[] = await repo.list();
    const revisions = new Map(files.map((file) => [file.slug, file.revision]));
    return assembleBoardTasks({ id: board.id }, files.map((file) => ({ ...file, origin }))).tasks.map((entry) => ({
      ...entry,
      task: {
        ...entry.task,
        source: entry.task.source && taskSource(origin, entry.task.source.filePath, revisions.get(taskSlug(entry.task))),
      },
    }));
  }

  /** Puts a task between the given neighbours of its board's manual order;
   *  the whole order is written, every task of the board in it. Drops go one
   *  at a time per board, each from a fresh read, so two drops arriving
   *  together both land; and the tasks are the board's main checkout — a
   *  thread's worktree lacks tasks main has, and they would fall out of the
   *  order. */
  function placeTask(taskId: string, neighbors: OrderNeighbors): Promise<void> {
    const board = requireBoard(taskId.split(":")[0] ?? "");
    return serialByBoard(`order:${board.id}`, async () => {
      const current = (await readBoard(board, roots.get(board.id) ?? [])).map((entry) => entry.task.id);
      writes += 1;
      await orders.set(board.id, moveInOrder(current, taskId, neighbors));
    });
  }

  /** Every board's tasks. A database board that cannot be read right now is
   *  left out rather than failing the rest: a lookup across boards, the
   *  lifecycle's thread scan and the CLI must keep working on the others.
   *  Reading that board alone still reports the failure. */
  async function loadAllBoards(): Promise<BoardTask[]> {
    const perBoard = await Promise.all(boardConfigs.map((board) => unlessOutOfReach(loadBoard(board), [])));
    return perBoard.flat();
  }

  /** The first task of any board that `pick` finds something on, with what it found. A board that
   *  cannot be read is passed over; when nothing was found, its failure is the answer — the item may
   *  well live there — a broken board's ahead of one out of reach. */
  async function findAcrossBoards<T>(pick: (task: BoardTask) => T | undefined): Promise<{ task: BoardTask; found: T } | undefined> {
    const reads = await Promise.allSettled(boardConfigs.map(loadBoard));
    for (const read of reads) {
      if (read.status !== "fulfilled") continue;
      for (const task of read.value) {
        const found = pick(task);
        if (found !== undefined) return { task, found };
      }
    }
    const failures = reads.flatMap((read) => (read.status === "rejected" ? [read.reason as unknown] : []));
    if (failures.length > 0) throw failures.find((failure) => !outOfReach(failure)) ?? failures[0];
    return undefined;
  }

  async function findAssembled(taskId: string): Promise<BoardTask | undefined> {
    const boardId = taskId.split(":")[0];
    const board = boardConfigs.find((b) => b.id === boardId);
    if (!board) return undefined;
    return (await loadBoard(board)).find((t) => t.task.id === taskId);
  }

  /** Re-reads one task's own file (not the whole board) so a mutation can
   *  patch it without discarding fields this module doesn't model
   *  (comments already parsed elsewhere, unknown frontmatter keys, …). */
  async function readOwnFile(task: Task) {
    const repo = boardRepos.repoFor(requireBoard(task.projectId));
    return parseFrontmatter(repo ? await repo.readText(task.source!.filePath) : await readFile(task.source!.filePath, "utf8"));
  }

  // ---------------------------------------------------------------- Folders
  const createFolder = (input: { id?: string; name: string; parentFolderId?: string | null }) =>
    folderCol.insert({
      name: requireNonEmpty(input.name, "Folder name"),
      parentFolderId: input.parentFolderId ?? null,
      createdAt: new Date().toISOString(),
      ...(input.id ? { id: input.id } : {}),
    });
  const getFolder = (id: string) => folderCol.get(id);
  const listFolders = () => folderCol.list();
  const updateFolder = (id: string, input: { name?: string; parentFolderId?: string | null }) =>
    folderCol.update(id, {
      ...(input.name !== undefined ? { name: requireNonEmpty(input.name, "Folder name") } : {}),
      ...(input.parentFolderId !== undefined ? { parentFolderId: input.parentFolderId } : {}),
    });
  const deleteFolder = (id: string) => folderCol.remove(id);

  // ---------------------------------------------------------------- Boards
  function createProject(input: {
    id?: string;
    name: string;
    prefix: string;
    color: string;
    folderId?: string | null;
    linkedBbProjectId?: string | null;
    tasksFolder?: string | null;
    database?: { url: string } | null;
  }): BoardConfig {
    const board: BoardConfig = {
      id: createOrValidateUlid(input.id),
      name: requireNonEmpty(input.name, "Project name"),
      prefix: input.prefix,
      color: input.color,
      folderId: input.folderId ?? null,
      linkedBbProjectId: input.linkedBbProjectId ?? null,
      tasksFolder: input.tasksFolder ?? null,
      database: input.database ?? null,
      createdAt: new Date().toISOString(),
    };
    boardConfigs = upsertBoardConfig(boardConfigs, board);
    persistBoards();
    return board;
  }
  const getProject = (id: string) => boardConfigs.find((b) => b.id === id);
  const listProjects = (folderId?: string | null) =>
    folderId === undefined ? boardConfigs : boardConfigs.filter((b) => b.folderId === folderId);
  // A caller that passes `{ prefix, name: undefined, … }` (the CLI does)
  // means "leave name alone", not "erase name": persisted as JSON, an
  // undefined field vanishes and the board comes back failing its schema.
  function updateProject(id: string, input: Partial<Omit<BoardConfig, "id">>): BoardConfig {
    const current = requireBoard(id);
    const updated = applyPatch(current, input);
    boardConfigs = upsertBoardConfig(boardConfigs, updated);
    persistBoards();
    return updated;
  }
  /** Changes the board's key prefix and renames its tasks with it (rekeyTasks);
   *  a database board's prefix is written into the database too, so every
   *  machine opening it takes the new one. The keys go first: a rename cut
   *  short leaves the old prefix on the board, and running it again finishes
   *  the job, since a task that already has its new key keeps it. All of it
   *  runs in the board's queue, so a task created meanwhile waits and is
   *  named under the new prefix. */
  function renameBoardPrefix(id: string, prefix: string): Promise<BoardConfig> {
    return retrying(() =>
      serialByBoard(id, async () => {
        const board = requireBoard(id);
        await rekeyTasks(board, prefix);
        await boardRepos.repoFor(board)?.writePrefix?.(prefix);
        return updateProject(board.id, { prefix });
      }),
    );
  }

  /** Writes every task of the board's main checkout whose name changes under
   *  `prefix` (filesync/prefix-rename.ts), with the old keys of the board
   *  replaced in its description and comments, and every child of a renamed
   *  task so its `parent:` names the new key. Parents go before their
   *  children — the child's `parent:` is the parent's key as written — and
   *  the board's unnamed tasks last: written in main, one gets its key minted
   *  under the new prefix, after every number is already where it goes. */
  async function rekeyTasks(board: BoardConfig, prefix: string): Promise<void> {
    const onBoard = await readBoard(board, roots.get(board.id) ?? []);
    const newKeys = rekeyBoard(onBoard.map((entry) => entry.task), { from: board.prefix, to: prefix });
    const keyOf = (task: Task) => newKeys.get(task.id) ?? task.key;
    const renames = new Map(onBoard.filter(({ task }) => keyOf(task) !== task.key).map(({ task }) => [task.key, keyOf(task)]));
    if (renames.size === 0) return;
    const byId = new Map(onBoard.map(({ task }) => [task.id, task]));
    const depth = (task: Task, limit = onBoard.length): number => {
      const parent = task.parentTaskId === null ? undefined : byId.get(task.parentTaskId);
      return parent === undefined || limit === 0 ? 0 : 1 + depth(parent, limit - 1);
    };
    const unnamedLast = (task: Task) => Number(task.number === null);
    const order = [...onBoard].sort((a, b) => unnamedLast(a.task) - unnamedLast(b.task) || depth(a.task) - depth(b.task));
    const renamedBoard = { ...board, prefix };
    for (const { task, comments } of order) {
      const description = rewriteMentions(task.description, renames);
      const rewritten = comments.map((comment) => ({ ...comment, body: rewriteMentions(comment.body, renames) }));
      const parent = task.parentTaskId === null ? undefined : byId.get(task.parentTaskId);
      const changed =
        keyOf(task) !== task.key ||
        description !== task.description ||
        rewritten.some((comment, index) => comment.body !== comments[index]?.body) ||
        (parent !== undefined && keyOf(parent) !== parent.key);
      if (!changed) continue;
      const label = task.number === null ? null : parseTaskKey(keyOf(task));
      const { data } = await readOwnFile(task);
      await writeNamedTask(renamedBoard, { ...task, description, ...(label ?? {}) }, rewritten, rootOfTask(board, task), data, {});
    }
  }

  function deleteProject(id: string): boolean {
    const before = boardConfigs.length;
    boardConfigs = removeBoardConfig(boardConfigs, id);
    if (boardConfigs.length !== before) persistBoards();
    return boardConfigs.length !== before;
  }

  // ------------------------------------------------------------------ Tasks
  async function getTask(id: string): Promise<Task | undefined> {
    return (await findAssembled(id))?.task;
  }
  async function requireTask(id: string): Promise<Task> {
    const task = await getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }
  /** By the board's key OR the file's slug, case-blind, across every board
   *  rather than routing by the key's prefix. Prefixes drift — a board
   *  renamed from BBPL to BP still holds files whose `key` says BBPL, and
   *  those tasks are listed, so they must open too. The slug is the address
   *  an agent has when the file was written by hand: a keyless task's key
   *  IS its slug (filesync/assemble.ts), and a keyed one answers to both. */
  async function getTaskByKey(keyOrSlug: string): Promise<Task | undefined> {
    const wanted = keyOrSlug.trim().toLowerCase();
    if (wanted === "") return undefined;
    return (await loadAllBoards()).find(
      (t) => t.task.key.toLowerCase() === wanted || taskSlug(t.task).toLowerCase() === wanted,
    )?.task;
  }
  async function listTasks(filters: ListTasksFilters = {}): Promise<Task[]> {
    const pool = filters.projectId
      ? await loadBoard(requireBoard(filters.projectId))
      : await loadAllBoards();
    return filterTasks(
      pool.map((t) => t.task),
      {
        statuses: filters.statuses,
        priorities: filters.priorities,
        labelIds: filters.labelIds,
        parentTaskId: filters.parentTaskId,
        search: filters.search,
        activeTaskIds: filters.activeOnly
          ? taskIdsWithThread(pool, isActiveThread)
          : undefined,
        waitingTaskIds: filters.waitingOnly
          ? taskIdsWithThread(pool, isWaitingThread)
          : undefined,
      },
    );
  }

  /** Threads for every task of a board, grouped by task id, from a single
   *  board read — the bulk counterpart to `listTaskThreads` for callers
   *  (like sidebarSummary) that need every task's threads: calling
   *  `listTaskThreads` once per task would re-read the whole board's files
   *  once per task (see decisions/tasks-plus-board-roots-blocks-rpc.md). */
  async function threadsByTaskId(projectId: string): Promise<Map<string, TaskThread[]>> {
    const assembled = await loadBoard(requireBoard(projectId));
    return new Map(assembled.map((t) => [t.task.id, t.threads]));
  }
  /** A page of the list — a project's in its manual order, every project's live statuses first (task-page.ts); a cursor this store did not give out is refused. */
  async function listTasksPage(filters: ListTasksFilters = {}): Promise<TaskPage> {
    const offset = filters.cursor === undefined ? 0 : parseTaskCursor(filters.cursor);
    if (offset === undefined) throw new Error(`Invalid task list cursor: ${filters.cursor}`);
    const tasks = await listTasks(filters);
    const ordered = filters.projectId ? tasks : byLiveStatusFirst(tasks);
    return taskPage(ordered, filters.limit ?? TASKS_PAGE_DEFAULT_LIMIT, offset);
  }
  async function listSubtasks(parentTaskId: string): Promise<Task[]> {
    return listTasks({ parentTaskId });
  }
  async function getSubtaskDoneCounts(parentTaskId: string): Promise<SubtaskDoneCounts> {
    const subtasks = await listSubtasks(parentTaskId);
    return { total: subtasks.length, done: subtasks.filter((t) => t.status === "done").length };
  }

  /** Ключ — имя задачи на доске, а доска видит задачу, только когда та лежит
   *  в main. Поэтому первая же запись в бесключевой файл главного чекаута
   *  чеканит следующий за наибольшим номер: задача, приехавшая слиянием,
   *  получает ключ на первой правке — неважно, правка это поля, смена
   *  статуса или комментарий. Задача, живущая в ветке, ключа не получает —
   *  доска её ещё не видит (BBPL-294). Id задачи от ключа не зависит: он
   *  строится из слага, поэтому чеканка не двигает ни ссылок, ни детей.
   *  Вызывается под очередью доски: чтение номеров и запись файла должны
   *  быть неделимы. */
  async function issuedKey(board: BoardConfig, task: Task, root: BoardRoot): Promise<Task> {
    if (task.number !== null || root.origin.kind === "worktree") return task;
    const onBoard = await loadBoard(board);
    // Пока этот вызов стоял в очереди, соседний мог уже дать задаче имя:
    // тогда берётся выданное, а не сжигается второй номер — иначе
    // вызывающему вернулось бы имя, которого на доске нет.
    const issued = onBoard.find((t) => t.task.id === task.id)?.task;
    if (issued && issued.number !== null) {
      return { ...task, number: issued.number, key: issued.key };
    }
    const number = nextTaskNumber(onBoard.map((t) => t.task.key), board.prefix);
    return { ...task, number, key: `${board.prefix}-${number}` };
  }

  /** A task as it was written: where, at which row version (`null` for a folder), and under which name. */
  interface WrittenTask {
    filePath: string;
    revision: number | null;
    task: Task;
  }

  /** Writes the file and reports the task as it was written — чеканка ключа
   *  меняет её имя на доске. Nothing commits it: the checkout's owner commits
   *  task files together with the rest of the tree (see
   *  decisions/tasks-plus-no-auto-publish.md). */
  async function persistTask(board: BoardConfig, input: Task, comments: readonly Comment[], root: BoardRoot, existingData: Record<string, unknown>, extraFields: Record<string, unknown>): Promise<WrittenTask> {
    // The board as it is once the queue lets this write in: a prefix renamed meanwhile names the task.
    return serialByBoard(board.id, () => writeNamedTask(requireBoard(board.id), input, comments, root, existingData, extraFields));
  }

  async function writeNamedTask(board: BoardConfig, input: Task, comments: readonly Comment[], root: BoardRoot, existingData: Record<string, unknown>, extraFields: Record<string, unknown>): Promise<WrittenTask> {
    const task = await issuedKey(board, input, root);
    const parent = task.parentTaskId ? await getTask(task.parentTaskId) : undefined;
    const slug = taskSlug(task);
    const content = renderTaskFile(
      {
        ...task,
        // A keyless task's `key` is its slug (assemble.ts) — a display
        // fallback, not a field: writing it would stamp `key: <slug>` into
        // every hand-written file the board so much as touches.
        key: task.number === null ? undefined : task.key,
        labels: task.labelIds,
        parentRef: parent?.key ?? null,
      },
      slug,
      comments,
      existingData,
      extraFields,
    );
    // Counted even when the write fails: the file may have moved already.
    try {
      const repo = boardRepos.repoFor(board);
      if (repo) {
        const { filePath, revision } = await repo.write({
          status: task.status,
          slug,
          placement: placementOf(task),
          content,
          ...(task.source ? { previousPath: task.source.filePath } : {}),
          ...(task.source?.revision == null ? {} : { revision: task.source.revision }),
        });
        return { filePath, revision, task };
      }
      const filePath = await writeTaskFile(root.absPath, task.status, slug, content, task.source?.filePath, placementOf(task));
      return { filePath, revision: null, task };
    } finally {
      writes += 1;
    }
  }


  async function createTask(input: CreateTaskInput): Promise<Task> {
    const board = requireBoard(input.projectId);
    // Под очередью доски целиком: слаг и номер читаются и пишутся неделимо,
    // иначе два одновременных создания взяли бы одно имя. Внутри зовётся
    // writeNamedTask, а не persistTask, — очередь не переиспользуема.
    return retrying(() => serialByBoard(board.id, () => createTaskInBoard(requireBoard(board.id), input)));
  }

  async function createTaskInBoard(board: BoardConfig, input: CreateTaskInput): Promise<Task> {
    const existing = await loadBoard(board);
    const slug = uniqueSlug(input.title, new Set(existing.map((t) => taskSlug(t.task))));
    const root = rootForNewTask(board);
    // Рождённая в ветке живёт без ключа: номер выдаёт доска, а доска увидит
    // задачу только после слияния (см. issuedKey).
    const number =
      root.origin.kind !== "worktree"
        ? nextTaskNumber(existing.map((t) => t.task.key), board.prefix)
        : null;
    const status = input.status ?? "backlog";
    const placement = nextPlacement(NO_PLACEMENT, input);
    const task: Task = {
      id: `${board.id}:${slug}`,
      projectId: board.id,
      number,
      key: number === null ? slug : `${board.prefix}-${number}`,
      title: requireNonEmpty(input.title, "Task title"),
      description: input.description ?? "",
      status,
      priority: input.priority ?? "none",
      type: input.type ?? null,
      estimate: input.estimate ?? null,
      plannedMinutes: validateMinutes(input.plannedMinutes ?? null, "plannedMinutes"),
      actualMinutes: validateMinutes(input.actualMinutes ?? null, "actualMinutes"),
      budget: validateDollars(input.budget ?? null, "budget"),
      budgetLimit: validateDollars(input.budgetLimit ?? null, "budgetLimit"),
      cost: validateDollars(input.cost ?? null, "cost"),
      dueDate: validateDueDate(input.dueDate ?? null),
      startDate: validateStartDate(input.startDate ?? null),
      parentTaskId: input.parentTaskId ?? null,
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      labelIds: [],
      takenBy: claimedTakenBy({ key: "", status }, { status: input.status, attachesThread: false, threadId: null }, machineName),
      ...placement,
      source: null,
    };
    const { filePath, revision } = await writeNamedTask(
      board,
      task,
      [],
      root,
      {},
      number === null ? { created: task.createdAt } : { key: task.key, created: task.createdAt },
    );
    return { ...task, source: taskSource(root.origin, filePath, revision) };
  }

  /** The board's label for a task as somebody typed it: normalised to
   *  upper case, shaped like PREFIX-NUMBER, not already on the board. Any
   *  prefix goes, not just the board's own — prefixes drift and files keep
   *  their old ones (decisions/tasks-every-file-in-a-status-folder-is-a-task.md). */
  function validateTaskKey(raw: string, takenLower: ReadonlySet<string>): { key: string; number: number } {
    const parsed = parseTaskKey(raw.toUpperCase());
    if (!parsed) throw new Error(`key ${JSON.stringify(raw)} must look like PREFIX-NUMBER`);
    if (takenLower.has(parsed.key.toLowerCase())) throw new Error(`key ${parsed.key} is already taken on this board`);
    return parsed;
  }

  /** What the task will be called after `input`: the slug is the file name
   *  and the id follows it; the key is the board's label and falls back to
   *  the slug when the task has none (assemble.ts does the same on read). */
  function relabel(current: Task, input: UpdateTaskInput, siblings: readonly BoardTask[]): Pick<Task, "id" | "key" | "number"> {
    const slug = input.slug === undefined
      ? taskSlug(current)
      : validateSlug(input.slug, new Set(siblings.map((t) => taskSlug(t.task))));
    const label = input.key === undefined
      ? current.number === null ? { key: slug, number: null } : { key: current.key, number: current.number }
      : input.key === null
        ? { key: slug, number: null }
        : validateTaskKey(input.key, new Set(siblings.map((t) => t.task.key.toLowerCase())));
    return { id: `${current.projectId}:${slug}`, ...label };
  }

  /** Re-writes every child so its `parent:` names the parent's new key or
   *  slug. The reference is a string in the child's own file that
   *  assemble.ts resolves by key or slug — left alone, a rename would
   *  silently orphan every subtask on the next read. The children are
   *  computed before the parent moved, and each is pointed at the new id
   *  explicitly because its old parentTaskId no longer resolves. */
  async function repointChildren(board: BoardConfig, children: readonly BoardTask[], parent: Task): Promise<void> {
    for (const child of children) {
      const { data } = await readOwnFile(child.task);
      await persistTask(board, { ...child.task, parentTaskId: parent.id }, child.comments, rootOfTask(board, child.task), data, {});
    }
  }

  function updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    return retrying(() => updateTaskFromRead(id, input));
  }

  async function updateTaskFromRead(id: string, input: UpdateTaskInput): Promise<Task> {
    const current = await requireTask(id);
    const board = requireBoard(current.projectId);
    const siblings = (await loadBoard(board)).filter((t) => t.task.id !== id);
    const { data } = await readOwnFile(current);
    const comments = (await findAssembled(id))?.comments ?? [];
    const updated: Task = {
      ...current,
      ...relabel(current, input, siblings),
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      priority: input.priority ?? current.priority,
      type: input.type === undefined ? current.type : input.type,
      estimate: input.estimate === undefined ? current.estimate : input.estimate,
      plannedMinutes: input.plannedMinutes === undefined ? current.plannedMinutes : validateMinutes(input.plannedMinutes, "plannedMinutes"),
      actualMinutes: input.actualMinutes === undefined ? current.actualMinutes : validateMinutes(input.actualMinutes, "actualMinutes"),
      budget: input.budget === undefined ? current.budget : validateDollars(input.budget, "budget"),
      budgetLimit: input.budgetLimit === undefined ? current.budgetLimit : validateDollars(input.budgetLimit, "budgetLimit"),
      cost: input.cost === undefined ? current.cost : validateDollars(input.cost, "cost"),
      dueDate: input.dueDate === undefined ? current.dueDate : validateDueDate(input.dueDate),
      startDate: input.startDate === undefined ? current.startDate : validateStartDate(input.startDate),
      parentTaskId: input.parentTaskId === undefined ? current.parentTaskId : input.parentTaskId,
      ...nextPlacement(placementOf(current), input),
      takenBy: claimedTakenBy(current, { status: input.status, attachesThread: false, threadId: null }, machineName),
      updatedAt: new Date().toISOString(),
    };
    const root = rootOfTask(board, current);
    // Ключ — имя задачи на доске, а в main задача на доске есть всегда:
    // отсутствие поля `key:` там означает «имя ещё не выдано», и следующая же
    // запись его выдаст (см. issuedKey). Снятие ключа поэтому имеет смысл
    // только в ветке, а в main это неисполнимая просьба, и честнее сказать об
    // этом сразу, чем сделать вид и вернуть ключ на первой же записи.
    if (input.key === null && root.origin.kind === "main") {
      throw new Error(
        current.number === null
          ? "у задачи в main ключа нет только до первой записи: он выдаётся сам, снимать нечего"
          : "снять ключ можно только у задачи, живущей в ветке: в main имя на доске есть у каждой задачи",
      );
    }
    // `key: null` takes the field off the file; leaving `data.key` in place
    // would put it straight back (renderTaskFile starts from existing data).
    // A time/money field set to null goes the same way — and only then, so a
    // line the reader could not parse survives every other write.
    // A plan date cleared to null goes the same way: `renderTaskFile` writes a
    // date only when it has one, so leaving the old `due:`/`start:` line in
    // `data` would put it straight back on the next read. (`due` had this
    // defect before `start` existed — clearing a due date did not stick.)
    const cleared = new Set<string>([
      ...(input.key === null ? ["key"] : []),
      ...AMOUNT_FIELDS.filter((field) => input[field] === null).map((field) => AMOUNT_KEYS[field]),
      ...(input.dueDate === null ? ["due"] : []),
      ...(input.startDate === null ? ["start"] : []),
    ]);
    const existing = Object.fromEntries(Object.entries(data).filter(([key]) => !cleared.has(key)));
    const { filePath, revision, task: written } = await persistTask(board, updated, comments, root, existing, {});
    if (written.id !== current.id || written.key !== current.key) {
      await repointChildren(board, siblings.filter((t) => t.task.parentTaskId === current.id), written);
    }
    return { ...written, source: taskSource(root.origin, filePath, revision) };
  }

  /** Removes the task's file for good — the way to drop a duplicate or a
   *  file that should never have been a task. Cancelling is a status
   *  (`updateTask` with `status: "canceled"`), not this. */
  function deleteTask(id: string): Promise<boolean> {
    return retrying(() => deleteTaskFromRead(id));
  }

  async function deleteTaskFromRead(id: string): Promise<boolean> {
    const current = await getTask(id);
    if (!current?.source) return false;
    const repo = boardRepos.repoFor(requireBoard(current.projectId));
    try {
      if (repo) await repo.remove(current.source.filePath, current.source.revision ?? undefined);
      else await rm(current.source.filePath, { force: true });
    } finally {
      writes += 1;
    }
    return true;
  }

  /** Carries out `planMigration` (filesync/epic-migrate.ts): an epic task
   *  per epic folder, made or reused, and every task of the folder moved up to
   *  the assignee's, the parentless ones under the epic. A dry run only tells. */
  async function migrateEpics(projectId: string, dryRun: boolean): Promise<MigratedEpic[]> {
    const board = requireBoard(projectId);
    // Epic folders are a folder board's: a database board has none to migrate.
    if (board.database) return [];
    const tasks = (await loadBoard(board)).map(({ task }) => task);
    const keyOf = new Map(tasks.map((task) => [task.id, task.key]));
    const plan = planMigration(tasks);
    if (dryRun) {
      return plan.map((group) => ({
        key: group.existingId === null ? null : (keyOf.get(group.existingId) ?? null),
        name: group.name,
        assignee: group.assignee,
        tasks: group.taskIds.length,
      }));
    }
    const migrated: MigratedEpic[] = [];
    // One folder after another: every step writes files the next one reads.
    for (const group of plan) {
      const epic =
        group.existingId === null
          ? await createTaskInBoard(board, { projectId, title: group.name, type: "epic", status: group.status, assignee: group.assignee })
          : await requireTask(group.existingId);
      for (const taskId of group.taskIds) {
        await updateTask(taskId, { epic: null, ...(group.childIds.includes(taskId) ? { parentTaskId: epic.id } : {}) });
      }
      await removeIfEmpty(join(rootOfTask(board, epic).absPath, group.assignee, group.name));
      migrated.push({ key: epic.key, name: group.name, assignee: group.assignee, tasks: group.taskIds.length });
    }
    return migrated;
  }

  /** `bb tasks keys issue`: names the board's unnamed tasks as the caller
   *  sees them (filesync/key-issue.ts) — from a thread, the tasks of its
   *  tree, which a write there never names (see issuedKey). Numbers held in
   *  the main checkout — tasks made on the board, not committed yet — are
   *  skipped too. Each file stays where it is; a child of a task named here
   *  is written again so its `parent:` names the new key. A database board
   *  names every task at birth: nothing to issue. Under the board's queue:
   *  numbers are read and written as one step. */
  function issueBoardKeys(projectId: string): Promise<{ slug: string; key: string }[]> {
    return retrying(() =>
      serialByBoard(projectId, async () => {
        const board = requireBoard(projectId);
        if (board.database) return [];
        const onBoard = await loadBoard(board);
        // From the main checkout itself the caller already sees main: nothing more to read.
        const fromTree = callerWorktreeRoot(board, readCallerEnvironment()) !== null;
        const inMain = fromTree ? await readBoard(board, roots.get(board.id) ?? []) : [];
        const issued = issueKeys(onBoard.map(({ task }) => task), board.prefix, inMain.map(({ task }) => task.key));
        const named = new Map(issued.map((label) => [label.id, label]));
        const rewritten = onBoard.filter(({ task }) => !named.has(task.id) && task.parentTaskId !== null && named.has(task.parentTaskId));
        const byId = new Map(onBoard.map((entry) => [entry.task.id, entry]));
        // Parents first (the plan's order), so each child reads its parent's new key.
        for (const { task, comments } of [...issued.map(({ id }) => byId.get(id)!), ...rewritten]) {
          const label = named.get(task.id);
          const { data } = await readOwnFile(task);
          await writeNamedTask(board, label === undefined ? task : { ...task, key: label.key, number: label.number }, comments, rootOfTask(board, task), data, {});
        }
        return issued.map(({ id, key }) => ({ slug: taskSlug(byId.get(id)!.task), key }));
      }),
    );
  }

  /** Assignees in use: the folders the board's tasks sit in,
   *  sorted by name. A folder with no task in it is not a value. */
  async function listPlacements(projectId: string): Promise<{ assignees: string[] }> {
    const assignees = new Set(
      (await loadBoard(requireBoard(projectId))).flatMap(({ task }) => (task.assignee ? [task.assignee] : [])),
    );
    return { assignees: [...assignees].sort((a, b) => a.localeCompare(b)) };
  }

  // ------------------------------------------------------------------ Labels
  async function boardLabels(boardId: string): Promise<Label[]> {
    const seen = new Set<string>();
    for (const t of await loadBoard(requireBoard(boardId))) for (const id of t.task.labelIds) seen.add(id);
    return [...seen].map((name) => ({ id: name, projectId: boardId, name, color: "#6b7280" }));
  }
  const createLabel = (input: CreateLabelInput): Label => ({
    id: input.name, projectId: input.projectId, name: input.name, color: input.color,
  });
  async function getLabel(id: string): Promise<Label | undefined> {
    const perBoard = await Promise.all(boardConfigs.map((b) => unlessOutOfReach(boardLabels(b.id), [])));
    return perBoard.flat().find((l) => l.id === id);
  }
  const listLabels = (projectId: string): Promise<Label[]> => boardLabels(projectId);
  async function updateLabel(id: string, input: UpdateLabelInput): Promise<Label> {
    const current = await getLabel(id);
    if (!current) throw new Error(`Label not found: ${id}`);
    return applyPatch(current, input);
  }
  /** Labels have no row of their own to delete (see boardLabels above) — a
   *  label is deleted by removing its name from every task that carries it. */
  async function deleteLabel(id: string): Promise<boolean> {
    let removed = false;
    for (const assembled of await loadAllBoards()) {
      if (assembled.task.labelIds.includes(id)) {
        await removeTaskLabel(assembled.task.id, id);
        removed = true;
      }
    }
    return removed;
  }
  function addTaskLabel(taskId: string, labelId: string) {
    return retrying(async () => {
      const task = await requireTask(taskId);
      if (!task.labelIds.includes(labelId)) await setTaskLabelsFromRead(taskId, [...task.labelIds, labelId]);
      return { taskId, labelId };
    });
  }
  const setTaskLabels = (taskId: string, labelIds: string[]): Promise<void> =>
    retrying(() => setTaskLabelsFromRead(taskId, labelIds));
  async function setTaskLabelsFromRead(taskId: string, labelIds: string[]): Promise<void> {
    const current = await requireTask(taskId);
    const board = requireBoard(current.projectId);
    const { data } = await readOwnFile(current);
    const comments = (await findAssembled(taskId))?.comments ?? [];
    const updated = { ...current, labelIds };
    await persistTask(board, updated, comments, rootOfTask(board, current), data, {});
  }
  function removeTaskLabel(taskId: string, labelId: string): Promise<boolean> {
    return retrying(async () => {
      const task = await requireTask(taskId);
      if (!task.labelIds.includes(labelId)) return false;
      await setTaskLabelsFromRead(taskId, task.labelIds.filter((id) => id !== labelId));
      return true;
    });
  }
  const listTaskLabels = async (taskId: string) => (await requireTask(taskId)).labelIds.map((labelId) => ({ taskId, labelId }));
  const listLabelsForTask = async (taskId: string) => {
    const task = await requireTask(taskId);
    return task.labelIds.map((name) => ({ id: name, projectId: task.projectId, name, color: "#6b7280" }));
  };

  // --------------------------------------------------------------- Comments
  async function requireComment(id: string): Promise<{ task: AssembledTask; comment: Comment }> {
    const owner = await findAcrossBoards((t) => t.comments.find((c) => c.id === id));
    if (!owner) throw new Error(`Comment not found: ${id}`);
    return { task: owner.task, comment: owner.found };
  }
  async function getComment(id: string): Promise<Comment | undefined> {
    try {
      return (await requireComment(id)).comment;
    } catch {
      return undefined;
    }
  }
  const createComment = (input: CreateCommentInput): Promise<Comment> => retrying(() => createCommentFromRead(input));
  async function createCommentFromRead(input: CreateCommentInput): Promise<Comment> {
    const task = await requireTask(input.taskId);
    const board = requireBoard(task.projectId);
    const { data } = await readOwnFile(task);
    const comments = (await findAssembled(task.id))?.comments ?? [];
    const comment: Comment = {
      id: createOrValidateUlid(input.id),
      taskId: task.id,
      kind: input.kind,
      authorName: requireNonEmpty(input.authorName, "Comment authorName"),
      presetName: input.presetName ?? null,
      threadId: validateThreadId(input.threadId ?? null),
      body: input.body,
      notifiedCount: input.notifiedCount ?? 0,
      createdAt: new Date().toISOString(),
    };
    await persistTask(board, task, [...comments, comment], rootOfTask(board, task), data, {});
    return comment;
  }
  async function listComments(taskId: string): Promise<Comment[]> {
    return (await findAssembled(taskId))?.comments ?? [];
  }
  async function getLatestAgentComment(taskId: string, excludeCommentId: string | null): Promise<Comment | undefined> {
    return (await listComments(taskId))
      .filter((c) => c.kind === "agent" && c.id !== excludeCommentId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }
  const updateComment = (id: string, input: UpdateCommentInput): Promise<Comment> => retrying(() => updateCommentFromRead(id, input));
  async function updateCommentFromRead(id: string, input: UpdateCommentInput): Promise<Comment> {
    const { task } = await requireComment(id);
    const board = requireBoard(task.task.projectId);
    const { data } = await readOwnFile(task.task);
    const comments = task.comments.map((c) =>
      c.id === id ? { ...c, body: input.body ?? c.body, notifiedCount: input.notifiedCount ?? c.notifiedCount } : c,
    );
    await persistTask(board, task.task, comments, rootOfTask(board, task.task), data, {});
    return comments.find((c) => c.id === id)!;
  }
  const deleteComment = (id: string): Promise<boolean> => retrying(() => deleteCommentFromRead(id));
  async function deleteCommentFromRead(id: string): Promise<boolean> {
    const { task } = await requireComment(id);
    const board = requireBoard(task.task.projectId);
    const { data } = await readOwnFile(task.task);
    const comments = task.comments.filter((c) => c.id !== id);
    await persistTask(board, task.task, comments, rootOfTask(board, task.task), data, {});
    return true;
  }

  // ------------------------------------------------------------ Attachments
  async function requireAttachmentOwner(id: string): Promise<{ task: AssembledTask; attachment: Attachment }> {
    const owner = await findAcrossBoards((t) => t.attachments.find((a) => a.id === id));
    if (!owner) throw new Error(`Attachment not found: ${id}`);
    return { task: owner.task, attachment: owner.found };
  }
  async function getAttachment(id: string): Promise<Attachment | undefined> {
    try {
      return (await requireAttachmentOwner(id)).attachment;
    } catch {
      return undefined;
    }
  }
  async function writeAttachments(task: AssembledTask, attachments: Attachment[]): Promise<void> {
    const board = requireBoard(task.task.projectId);
    const { data } = await readOwnFile(task.task);
    await persistTask(board, task.task, task.comments, rootOfTask(board, task.task), data, { attachments });
  }
  const createAttachment = (input: CreateAttachmentInput): Promise<Attachment> => retrying(() => createAttachmentFromRead(input));
  async function createAttachmentFromRead(input: CreateAttachmentInput): Promise<Attachment> {
    const taskId = input.taskId ?? (await requireComment(input.commentId!)).task.task.id;
    // Задачи может не быть в той папке, которую видит запрос: файл лежит в
    // чужом дереве или ещё не приехал в main. Без этой проверки обращение к
    // полям несуществующей задачи давало TypeError и 500 вместо ответа.
    const task = await findAssembled(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const attachment: Attachment = {
      id: createOrValidateUlid(input.id),
      taskId: input.taskId ?? null,
      commentId: input.commentId ?? null,
      fileName: input.fileName,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      blobPath: input.blobPath,
      isImage: input.isImage,
      createdAt: new Date().toISOString(),
    };
    await writeAttachments(task, [...task.attachments, attachment]);
    return attachment;
  }
  const listAttachmentsForTask = async (taskId: string) => (await findAssembled(taskId))?.attachments ?? [];
  const listAttachmentsForComment = async (commentId: string) => {
    return (await loadAllBoards()).flatMap((t) => t.attachments).filter((a) => a.commentId === commentId);
  };
  const updateAttachment = (id: string, input: UpdateAttachmentInput): Promise<Attachment> => retrying(() => updateAttachmentFromRead(id, input));
  async function updateAttachmentFromRead(id: string, input: UpdateAttachmentInput): Promise<Attachment> {
    const { task, attachment } = await requireAttachmentOwner(id);
    const updated = { ...attachment, ...input };
    await writeAttachments(task, task.attachments.map((a) => (a.id === id ? updated : a)));
    return updated;
  }
  const deleteAttachment = (id: string): Promise<boolean> => retrying(() => deleteAttachmentFromRead(id));
  async function deleteAttachmentFromRead(id: string): Promise<boolean> {
    const { task } = await requireAttachmentOwner(id);
    await writeAttachments(task, task.attachments.filter((a) => a.id !== id));
    return true;
  }

  // ---------------------------------------------------------------- Threads
  async function requireThreadOwner(id: string): Promise<{ task: BoardTask; thread: TaskThread }> {
    const owner = await findAcrossBoards((t) => t.threads.find((th) => th.id === id));
    if (!owner) throw new Error(`Task thread not found: ${id}`);
    return { task: owner.task, thread: owner.found };
  }
  /** Which threads are attached to the task — the fact, not their state.
   *  Written when somebody attaches or detaches a thread and at no other
   *  time. */
  async function writeThreads(task: BoardTask, threads: readonly AttachedThread[], takenBy?: TakenBy | null): Promise<void> {
    const board = requireBoard(task.task.projectId);
    const { data } = await readOwnFile(task.task);
    await persistTask(board, takenBy === undefined ? task.task : { ...task.task, takenBy }, task.comments, rootOfTask(board, task.task), data, {
      threads: threads.map(serializeAttachedThread),
    });
  }
  function setThreadLiveState(threadId: string, state: ThreadLiveState): void {
    liveStates.set(threadId, state);
  }
  function getThreadLiveState(threadId: string): ThreadLiveState | undefined {
    return liveStates.get(threadId);
  }
  async function getTaskThread(id: string): Promise<TaskThread | undefined> {
    try {
      return (await requireThreadOwner(id)).thread;
    } catch {
      return undefined;
    }
  }
  async function getTaskThreadByThreadId(taskId: string, threadId: string): Promise<TaskThread | undefined> {
    return (await findAssembled(taskId))?.threads.find((t) => t.threadId === threadId);
  }
  const upsertTaskThread = (input: UpsertTaskThreadInput): Promise<TaskThread> => retrying(() => upsertTaskThreadFromRead(input));
  async function upsertTaskThreadFromRead(input: UpsertTaskThreadInput): Promise<TaskThread> {
    const task = (await findAssembled(input.taskId))!;
    // Attaching a thread takes the task; the check is against the read just made.
    // The claim rule clears the mark of a task that stays in backlog/todo, but
    // the thread is attached before the status moves (delegate/index.ts) and
    // its mark must survive that: there the take is asked for as In Progress.
    // Only the mark is written — the task's status is not touched here.
    const restsBeforeProgress = task.task.status === "backlog" || task.task.status === "todo";
    const takenBy = claimedTakenBy(
      task.task,
      { status: restsBeforeProgress ? "in_progress" : undefined, attachesThread: true, threadId: input.threadId },
      machineName,
    );
    const existing = task.threads.find((t) => t.threadId === input.threadId);
    const thread: AttachedThread = {
      id: existing?.id ?? createOrValidateUlid(input.id),
      taskId: input.taskId,
      threadId: validateThreadId(input.threadId),
      presetName: requireNonEmpty(input.presetName, "Task thread presetName"),
      title: requireNonEmpty(input.title, "Task thread title"),
      attachedAt: existing?.attachedAt ?? new Date().toISOString(),
    };
    await writeThreads(task, existing ? task.threads.map((t) => (t.id === thread.id ? thread : t)) : [...task.threads, thread], takenBy);
    return withLiveState(thread, liveStates.get(thread.threadId));
  }
  const listTaskThreads = async (taskId: string) => (await findAssembled(taskId))?.threads ?? [];
  /** Card chips — attachment count and threads — for many tasks with one
   *  read per board, in the order asked; ids no board knows are left out.
   *  Asking listAttachmentsForTask / listTaskThreads per card re-reads the
   *  whole board once per card (BBPL-334). */
  async function taskCardMeta(taskIds: readonly string[]): Promise<TaskCardMeta[]> {
    const boardIds = [...new Set(taskIds.map((id) => id.split(":")[0]))];
    const loaded = await Promise.all(
      boardConfigs.filter((b) => boardIds.includes(b.id)).map((b) => unlessOutOfReach(loadBoard(b), [])),
    );
    const byId = new Map(loaded.flat().map((t) => [t.task.id, t]));
    return taskIds.flatMap((taskId) => {
      const found = byId.get(taskId);
      return found
        ? [{ taskId, attachmentCount: found.attachments.length, taskThreads: found.threads }]
        : [];
    });
  }
  async function listTasksForThread(threadId: string): Promise<Task[]> {
    return (await loadAllBoards()).filter((t) => t.threads.some((th) => th.threadId === threadId)).map((t) => t.task);
  }
  const deleteTaskThread = (id: string): Promise<boolean> => retrying(() => deleteTaskThreadFromRead(id));
  async function deleteTaskThreadFromRead(id: string): Promise<boolean> {
    const { task } = await requireThreadOwner(id);
    await writeThreads(task, task.threads.filter((t) => t.id !== id));
    return true;
  }

  // --------------------------------------------------------- Presets/Views
  // Views are cleaned of retired Display fields on the way IN, by
  // `migrateSavedView` — before the schema sees them, because a retired name
  // fails its enum and a record that fails to parse is dropped and then
  // erased. Nothing retired can reach the collection, so there is nothing to
  // filter on the way out.
  const createPreset = (input: CreatePresetInput) => presetCol.insert({ ...input, builtin: input.builtin ?? false, createdAt: new Date().toISOString() } as Omit<Preset, "id">);
  const getPreset = (id: string) => presetCol.get(id);
  const listPresets = () => presetCol.list();
  const updatePreset = (id: string, input: UpdatePresetInput) => presetCol.update(id, input);
  const deletePreset = (id: string) => presetCol.remove(id);
  /** Saving under a name already taken overwrites that view and keeps its id
   *  and creation time — see docs/decisions/saved-view-name-overwrite.md.
   *  The first pass recorded that decision but never implemented it; with
   *  `scope` gone the name alone is the key. */
  const createSavedView = (input: CreateSavedViewInput) => {
    const name = input.name.trim();
    const existing = viewCol
      .list()
      .find((view) => view.name.trim().toLowerCase() === name.toLowerCase());
    // The RPC hands over parsed input with the schema's defaults; callers
    // below it — the store's own tests — may still omit surface, board and
    // table.
    const body = {
      ...input,
      name,
      surface: input.surface ?? "table",
      board: input.board ?? null,
      table: input.table ?? null,
      version: 2 as const,
    };
    return existing
      ? viewCol.update(existing.id, body)
      : viewCol.insert({ ...body, createdAt: new Date().toISOString() } as Omit<SavedView, "id">);
  };
  /** Every view, of every surface: a view names the list it opens. */
  const listSavedViews = () => viewCol.list();
  const updateSavedView = (id: string, input: { name: string }) => viewCol.update(id, input);
  const deleteSavedView = (id: string) => viewCol.remove(id);

  /**
   * No real transaction: each mutation already writes its own file in one
   * call, and there is no cross-file atomicity to buy here (see
   * decisions/tasks-files-are-the-store.md). Kept only so callers written
   * against the SQL store's `store.transaction(() => ...)` wrapping several
   * mutations don't need to change; `fn` may itself be async now.
   */
  async function transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return await fn();
  }

  return {
    transaction,
    setBoardRoots,
    setBoardRepo, removeBoardRepo,
    createFolder, getFolder, listFolders, updateFolder, deleteFolder,
    createProject, getProject, listProjects, updateProject, renameBoardPrefix, deleteProject,
    createTask, getTask, getTaskByKey, listTasksPage, listTasks, listSubtasks, getSubtaskDoneCounts, updateTask, deleteTask, placeTask, threadsByTaskId, listPlacements, migrateEpics, issueBoardKeys,
    createLabel, getLabel, listLabels, updateLabel, deleteLabel, addTaskLabel, removeTaskLabel, listTaskLabels, listLabelsForTask,
    createComment, getComment, listComments, getLatestAgentComment, updateComment, deleteComment,
    createAttachment, getAttachment, listAttachmentsForTask, listAttachmentsForComment, updateAttachment, deleteAttachment,
    upsertTaskThread, getTaskThread, getTaskThreadByThreadId, listTaskThreads, taskCardMeta, listTasksForThread, deleteTaskThread,
    setThreadLiveState, getThreadLiveState,
    createPreset, getPreset, listPresets, updatePreset, deletePreset,
    createSavedView, listSavedViews, updateSavedView, deleteSavedView,
  };
}

export type FileTasksStore = ReturnType<typeof createFileTasksStore>;

export async function loadFileTasksStore(
  kv: KvStore,
  onError: (error: unknown) => void,
  /** Обязателен: забытая проводка тихо оставила бы каждый тред на main —
   *  ровно тот дефект, который чинила BBPL-293. */
  readCallerEnvironment: () => CallerEnvironment | null,
  /** The name this machine stamps on the tasks it takes. */
  machineName = "local",
): Promise<FileTasksStore> {
  const [boards, folders, presets, savedViews, taskOrders] = await Promise.all([
    readBoardConfigs(kv),
    loadKvCollection<Folder>(kv, "folders"),
    loadKvCollection<Preset>(kv, "presets"),
    loadKvCollection<unknown>(kv, "savedViews"),
    loadTaskOrders(kv),
  ]);
  // Records written by the first pass carry a `scope` instead of a surface;
  // they are translated on the way in, not dropped. See
  // docs/decisions/saved-view-config-migration.md.
  const migratedViews = savedViews
    .map(migrateSavedView)
    .filter((view): view is SavedView => view !== null);
  return createFileTasksStore(kv, boards, folders, presets, migratedViews, onError, readCallerEnvironment, taskOrders, machineName);
}
