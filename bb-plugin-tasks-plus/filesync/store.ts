import type {
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
  TaskCheck,
  UpdateAttachmentInput,
  UpdateCommentInput,
  UpdateLabelInput,
  UpdatePresetInput,
  UpdateTaskInput,
  UpsertTaskThreadInput,
  Attachment,
} from "../db/types.js";
import type { Comment, Label, Task, TaskThread } from "../shared/contract.js";
import {
  readBoardConfigs,
  writeBoardConfigs,
  upsertBoardConfig,
  removeBoardConfig,
  nextTaskNumber,
  type BoardConfig,
  type KvStore,
} from "./board-config.js";
import { loadKvCollection, createKvCollection } from "./kv-collection.js";
import { applyPatch } from "./patch.js";
import { onePerSlug, readBoardTaskFiles, type BoardRoot } from "./fs-boards.js";
import { createSerialByKey } from "./serial-by-key.js";
import { callerWorktreeRoot, requestRoots, type CallerEnvironment } from "./caller-root.js";
import { rootOfTaskFile, writeTaskFile } from "./fs-repo.js";
import { nextPlacement, NO_PLACEMENT, type TaskPlacement } from "./placement.js";
import { readFile, rm } from "node:fs/promises";
import { assembleBoardTasks, parseTaskKey, taskSlug, type AssembledTask } from "./assemble.js";
import {
  serializeAttachedThread,
  withLiveState,
  type AttachedThread,
  type ThreadLiveState,
} from "../threads/live-state.js";
import { AMOUNT_KEYS, renderTaskFile } from "./task-file.js";
import { parseFrontmatter } from "./frontmatter.js";
import { ROW_FIELDS } from "../shared/enums.js";
import { AMOUNT_FIELDS } from "../shared/amounts.js";
import { filterTasks } from "./query.js";
import { uniqueSlug, validateSlug } from "./slug.js";
import { createOrValidateUlid, requireNonEmpty, validateDueDate, validateDollars, validateMinutes, validateThreadId } from "./validators.js";

const KNOWN_ROW_FIELDS = new Set<string>(ROW_FIELDS);

interface FileListTasksPage {
  tasks: Task[];
  nextCursor: string | null;
}

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
) {
  let boardConfigs = boards;
  const roots = new Map<string, BoardRoot[]>();
  /** Where each attached bb thread is right now, keyed by bb thread id
   *  (state belongs to the thread, not to one of the tasks it is attached
   *  to). Process memory on purpose: it changes every few minutes and
   *  writing it into the task file turned every status flip into a commit —
   *  see memory/decisions/tasks-plus-thread-state-is-not-a-file-field.md.
   *  Filled by lifecycle/index.ts from bb's own thread events. */
  const liveStates = new Map<string, ThreadLiveState>();
  /** Выдача имени задаче — «прочитать номера доски и записать файл» — идёт по
   *  одной на доску: два одновременных запроса иначе прочитали бы один и тот
   *  же наибольший номер и выдали бы двум задачам один ключ. */
  const serialByBoard = createSerialByKey();
  const folderCol = createKvCollection<Folder>(kv, "folders", folders, onError);
  const presetCol = createKvCollection<Preset>(kv, "presets", presets, onError);
  const viewCol = createKvCollection<SavedView>(kv, "savedViews", savedViews, onError);

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
    return callerWorktreeRoot(board, readCallerEnvironment()) ?? boardMainRoot(board);
  }

  /** Every request re-reads the board's files fresh, no cache — see
   *  decisions/tasks-files-are-the-store.md. Async (node:fs/promises) so a
   *  read does not block the plugin's single event loop while it waits on
   *  disk — see decisions/tasks-plus-board-roots-blocks-rpc.md. */
  async function loadBoard(board: BoardConfig): Promise<BoardTask[]> {
    const files = onePerSlug(await readBoardTaskFiles(boardRequestRoots(board)));
    return assembleBoardTasks({ id: board.id }, files).tasks.map((task) => ({
      ...task,
      threads: task.threads.map((thread) =>
        withLiveState(thread, liveStates.get(thread.threadId)),
      ),
    }));
  }

  async function loadAllBoards(): Promise<BoardTask[]> {
    return (await Promise.all(boardConfigs.map(loadBoard))).flat();
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
    return parseFrontmatter(await readFile(task.source!.filePath, "utf8"));
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
  }): BoardConfig {
    const board: BoardConfig = {
      id: createOrValidateUlid(input.id),
      name: requireNonEmpty(input.name, "Project name"),
      prefix: input.prefix,
      color: input.color,
      folderId: input.folderId ?? null,
      linkedBbProjectId: input.linkedBbProjectId ?? null,
      tasksFolder: input.tasksFolder ?? null,
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
  async function listTasksPage(filters: ListTasksFilters = {}): Promise<FileListTasksPage> {
    const limit = filters.limit ?? 100;
    return { tasks: (await listTasks(filters)).slice(0, limit), nextCursor: null };
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
    if (task.number !== null || root.origin.kind !== "main") return task;
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

  /** Writes the file and reports the task as it was written — чеканка ключа
   *  меняет её имя на доске. Nothing commits it: the checkout's owner commits
   *  task files together with the rest of the tree (see
   *  decisions/tasks-plus-no-auto-publish.md). */
  async function persistTask(board: BoardConfig, input: Task, comments: readonly Comment[], root: BoardRoot, existingData: Record<string, unknown>, extraFields: Record<string, unknown>): Promise<{ filePath: string; task: Task }> {
    return serialByBoard(board.id, () => writeNamedTask(board, input, comments, root, existingData, extraFields));
  }

  async function writeNamedTask(board: BoardConfig, input: Task, comments: readonly Comment[], root: BoardRoot, existingData: Record<string, unknown>, extraFields: Record<string, unknown>): Promise<{ filePath: string; task: Task }> {
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
        checks: task.checks,
        parentRef: parent?.key ?? null,
      },
      slug,
      comments,
      existingData,
      extraFields,
    );
    const filePath = await writeTaskFile(root.absPath, task.status, slug, content, task.source?.filePath, placementOf(task));
    return { filePath, task };
  }


  async function createTask(input: CreateTaskInput): Promise<Task> {
    const board = requireBoard(input.projectId);
    // Под очередью доски целиком: слаг и номер читаются и пишутся неделимо,
    // иначе два одновременных создания взяли бы одно имя. Внутри зовётся
    // writeNamedTask, а не persistTask, — очередь не переиспользуема.
    return serialByBoard(board.id, () => createTaskInBoard(board, input));
  }

  async function createTaskInBoard(board: BoardConfig, input: CreateTaskInput): Promise<Task> {
    const existing = await loadBoard(board);
    const slug = uniqueSlug(input.title, new Set(existing.map((t) => taskSlug(t.task))));
    const root = rootForNewTask(board);
    // Рождённая в ветке живёт без ключа: номер выдаёт доска, а доска увидит
    // задачу только после слияния (см. issuedKey).
    const number =
      root.origin.kind === "main"
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
      parentTaskId: input.parentTaskId ?? null,
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      labelIds: [],
      checks: [...(input.checks ?? [])],
      ...placement,
      source: null,
    };
    const { filePath } = await writeNamedTask(
      board,
      task,
      [],
      root,
      {},
      number === null ? { created: task.createdAt } : { key: task.key, created: task.createdAt },
    );
    return { ...task, source: { filePath, origin: root.origin } };
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

  async function updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
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
      parentTaskId: input.parentTaskId === undefined ? current.parentTaskId : input.parentTaskId,
      checks: input.checks ? [...input.checks] : current.checks,
      ...nextPlacement(placementOf(current), input),
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
    const cleared = new Set<string>([
      ...(input.key === null ? ["key"] : []),
      ...AMOUNT_FIELDS.filter((field) => input[field] === null).map((field) => AMOUNT_KEYS[field]),
    ]);
    const existing = Object.fromEntries(Object.entries(data).filter(([key]) => !cleared.has(key)));
    const { filePath, task: written } = await persistTask(board, updated, comments, root, existing, {});
    if (written.id !== current.id || written.key !== current.key) {
      await repointChildren(board, siblings.filter((t) => t.task.parentTaskId === current.id), written);
    }
    return { ...written, source: { filePath, origin: root.origin } };
  }

  /** Removes the task's file for good — the way to drop a duplicate or a
   *  file that should never have been a task. Cancelling is a status
   *  (`updateTask` with `status: "canceled"`), not this. */
  async function deleteTask(id: string): Promise<boolean> {
    const current = await getTask(id);
    if (!current?.source) return false;
    await rm(current.source.filePath, { force: true });
    return true;
  }

  /** Assignees and epics in use: the folders the board's tasks sit in,
   *  sorted by name. A folder with no task in it is not a value. */
  async function listPlacements(projectId: string): Promise<{ assignees: string[]; epics: { assignee: string; name: string }[] }> {
    const assignees = new Set<string>();
    const epics = new Map<string, { assignee: string; name: string }>();
    for (const { task } of await loadBoard(requireBoard(projectId))) {
      if (!task.assignee) continue;
      assignees.add(task.assignee);
      if (task.epic) epics.set(JSON.stringify([task.assignee, task.epic]), { assignee: task.assignee, name: task.epic });
    }
    const byName = (a: string, b: string) => a.localeCompare(b);
    return {
      assignees: [...assignees].sort(byName),
      epics: [...epics.values()].sort((a, b) => byName(a.assignee, b.assignee) || byName(a.name, b.name)),
    };
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
    const perBoard = await Promise.all(boardConfigs.map((b) => boardLabels(b.id)));
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
    for (const board of boardConfigs) {
      for (const assembled of await loadBoard(board)) {
        if (assembled.task.labelIds.includes(id)) {
          await removeTaskLabel(assembled.task.id, id);
          removed = true;
        }
      }
    }
    return removed;
  }
  async function addTaskLabel(taskId: string, labelId: string) {
    const task = await requireTask(taskId);
    if (!task.labelIds.includes(labelId)) await setTaskLabels(taskId, [...task.labelIds, labelId]);
    return { taskId, labelId };
  }
  async function setTaskLabels(taskId: string, labelIds: string[]): Promise<void> {
    const current = await requireTask(taskId);
    const board = requireBoard(current.projectId);
    const { data } = await readOwnFile(current);
    const comments = (await findAssembled(taskId))?.comments ?? [];
    const updated = { ...current, labelIds };
    await persistTask(board, updated, comments, rootOfTask(board, current), data, {});
  }
  async function removeTaskLabel(taskId: string, labelId: string): Promise<boolean> {
    const task = await requireTask(taskId);
    if (!task.labelIds.includes(labelId)) return false;
    await setTaskLabels(taskId, task.labelIds.filter((id) => id !== labelId));
    return true;
  }
  const listTaskLabels = async (taskId: string) => (await requireTask(taskId)).labelIds.map((labelId) => ({ taskId, labelId }));
  const listLabelsForTask = async (taskId: string) => {
    const task = await requireTask(taskId);
    return task.labelIds.map((name) => ({ id: name, projectId: task.projectId, name, color: "#6b7280" }));
  };
  const listTaskChecks = async (taskId: string): Promise<TaskCheck[]> => (await requireTask(taskId)).checks;
  async function replaceTaskChecks(taskId: string, checks: readonly TaskCheck[]): Promise<void> {
    await updateTask(taskId, { checks: [...checks] });
  }

  // --------------------------------------------------------------- Comments
  async function requireComment(id: string): Promise<{ task: AssembledTask; comment: Comment }> {
    for (const board of boardConfigs) {
      for (const t of await loadBoard(board)) {
        const comment = t.comments.find((c) => c.id === id);
        if (comment) return { task: t, comment };
      }
    }
    throw new Error(`Comment not found: ${id}`);
  }
  async function getComment(id: string): Promise<Comment | undefined> {
    try {
      return (await requireComment(id)).comment;
    } catch {
      return undefined;
    }
  }
  async function createComment(input: CreateCommentInput): Promise<Comment> {
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
  async function updateComment(id: string, input: UpdateCommentInput): Promise<Comment> {
    const { task } = await requireComment(id);
    const board = requireBoard(task.task.projectId);
    const { data } = await readOwnFile(task.task);
    const comments = task.comments.map((c) =>
      c.id === id ? { ...c, body: input.body ?? c.body, notifiedCount: input.notifiedCount ?? c.notifiedCount } : c,
    );
    await persistTask(board, task.task, comments, rootOfTask(board, task.task), data, {});
    return comments.find((c) => c.id === id)!;
  }
  async function deleteComment(id: string): Promise<boolean> {
    const { task } = await requireComment(id);
    const board = requireBoard(task.task.projectId);
    const { data } = await readOwnFile(task.task);
    const comments = task.comments.filter((c) => c.id !== id);
    await persistTask(board, task.task, comments, rootOfTask(board, task.task), data, {});
    return true;
  }

  // ------------------------------------------------------------ Attachments
  async function requireAttachmentOwner(id: string): Promise<{ task: AssembledTask; attachment: Attachment }> {
    for (const board of boardConfigs) {
      for (const t of await loadBoard(board)) {
        const attachment = t.attachments.find((a) => a.id === id);
        if (attachment) return { task: t, attachment };
      }
    }
    throw new Error(`Attachment not found: ${id}`);
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
  async function createAttachment(input: CreateAttachmentInput): Promise<Attachment> {
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
    const perBoard = await Promise.all(boardConfigs.map((b) => loadBoard(b)));
    return perBoard.flat().flatMap((t) => t.attachments).filter((a) => a.commentId === commentId);
  };
  async function updateAttachment(id: string, input: UpdateAttachmentInput): Promise<Attachment> {
    const { task, attachment } = await requireAttachmentOwner(id);
    const updated = { ...attachment, ...input };
    await writeAttachments(task, task.attachments.map((a) => (a.id === id ? updated : a)));
    return updated;
  }
  async function deleteAttachment(id: string): Promise<boolean> {
    const { task } = await requireAttachmentOwner(id);
    await writeAttachments(task, task.attachments.filter((a) => a.id !== id));
    return true;
  }

  // ---------------------------------------------------------------- Threads
  async function requireThreadOwner(id: string): Promise<{ task: BoardTask; thread: TaskThread }> {
    for (const board of boardConfigs) {
      for (const t of await loadBoard(board)) {
        const thread = t.threads.find((th) => th.id === id);
        if (thread) return { task: t, thread };
      }
    }
    throw new Error(`Task thread not found: ${id}`);
  }
  /** Which threads are attached to the task — the fact, not their state.
   *  Written when somebody attaches or detaches a thread and at no other
   *  time. */
  async function writeThreads(task: BoardTask, threads: readonly AttachedThread[]): Promise<void> {
    const board = requireBoard(task.task.projectId);
    const { data } = await readOwnFile(task.task);
    await persistTask(board, task.task, task.comments, rootOfTask(board, task.task), data, {
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
  async function upsertTaskThread(input: UpsertTaskThreadInput): Promise<TaskThread> {
    const task = (await findAssembled(input.taskId))!;
    const existing = task.threads.find((t) => t.threadId === input.threadId);
    const thread: AttachedThread = {
      id: existing?.id ?? createOrValidateUlid(input.id),
      taskId: input.taskId,
      threadId: validateThreadId(input.threadId),
      presetName: requireNonEmpty(input.presetName, "Task thread presetName"),
      title: requireNonEmpty(input.title, "Task thread title"),
      attachedAt: existing?.attachedAt ?? new Date().toISOString(),
    };
    await writeThreads(task, existing ? task.threads.map((t) => (t.id === thread.id ? thread : t)) : [...task.threads, thread]);
    return withLiveState(thread, liveStates.get(thread.threadId));
  }
  const listTaskThreads = async (taskId: string) => (await findAssembled(taskId))?.threads ?? [];
  async function listTasksForThread(threadId: string): Promise<Task[]> {
    return (await loadAllBoards()).filter((t) => t.threads.some((th) => th.threadId === threadId)).map((t) => t.task);
  }
  async function deleteTaskThread(id: string): Promise<boolean> {
    const { task } = await requireThreadOwner(id);
    await writeThreads(task, task.threads.filter((t) => t.id !== id));
    return true;
  }

  // --------------------------------------------------------- Presets/Views
  // A view saved before a Display field was retired (e.g. `tokens`) would fail
  // the contract's field enum on the way out; drop the retired entries instead.
  const withKnownFields = (view: SavedView): SavedView =>
    Array.isArray(view.config?.fields)
      ? { ...view, config: { ...view.config, fields: view.config.fields.filter((entry) => KNOWN_ROW_FIELDS.has(entry.field)) } }
      : view;
  const createPreset = (input: CreatePresetInput) => presetCol.insert({ ...input, builtin: input.builtin ?? false, createdAt: new Date().toISOString() } as Omit<Preset, "id">);
  const getPreset = (id: string) => presetCol.get(id);
  const listPresets = () => presetCol.list();
  const updatePreset = (id: string, input: UpdatePresetInput) => presetCol.update(id, input);
  const deletePreset = (id: string) => presetCol.remove(id);
  const createSavedView = (input: CreateSavedViewInput) => viewCol.insert({ ...input, createdAt: new Date().toISOString() } as Omit<SavedView, "id">);
  const listSavedViews = (scope: string) => viewCol.list().filter((v) => v.scope === scope).map(withKnownFields);
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
    createFolder, getFolder, listFolders, updateFolder, deleteFolder,
    createProject, getProject, listProjects, updateProject, deleteProject,
    createTask, getTask, getTaskByKey, listTasksPage, listTasks, listSubtasks, getSubtaskDoneCounts, updateTask, deleteTask, threadsByTaskId, listPlacements,
    createLabel, getLabel, listLabels, updateLabel, deleteLabel, addTaskLabel, removeTaskLabel, listTaskLabels, listLabelsForTask,
    listTaskChecks, replaceTaskChecks,
    createComment, getComment, listComments, getLatestAgentComment, updateComment, deleteComment,
    createAttachment, getAttachment, listAttachmentsForTask, listAttachmentsForComment, updateAttachment, deleteAttachment,
    upsertTaskThread, getTaskThread, getTaskThreadByThreadId, listTaskThreads, listTasksForThread, deleteTaskThread,
    setThreadLiveState, getThreadLiveState,
    createPreset, getPreset, listPresets, updatePreset, deletePreset,
    createSavedView, listSavedViews, deleteSavedView,
  };
}

export type FileTasksStore = ReturnType<typeof createFileTasksStore>;

export async function loadFileTasksStore(
  kv: KvStore,
  onError: (error: unknown) => void,
  /** Обязателен: забытая проводка тихо оставила бы каждый тред на main —
   *  ровно тот дефект, который чинила BBPL-293. */
  readCallerEnvironment: () => CallerEnvironment | null,
): Promise<FileTasksStore> {
  const [boards, folders, presets, savedViews] = await Promise.all([
    readBoardConfigs(kv),
    loadKvCollection<Folder>(kv, "folders"),
    loadKvCollection<Preset>(kv, "presets"),
    loadKvCollection<SavedView>(kv, "savedViews"),
  ]);
  return createFileTasksStore(kv, boards, folders, presets, savedViews, onError, readCallerEnvironment);
}
