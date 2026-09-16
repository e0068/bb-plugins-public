import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";
import type { CallerEnvironment } from "./caller-root.js";

let root: string;
let kv: KvStore;
let store: ReturnType<typeof createFileTasksStore>;
let board: BoardConfig;

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key) as never;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "store-"));
  kv = fakeKv();
  board = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", createdAt: "2026-01-01T00:00:00.000Z" };
  store = createFileTasksStore(kv, [board], [], [], [], () => {});
  store.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("task lifecycle", () => {
  it("создаёт, читает и обновляет", async () => {
    const created = await store.createTask({ projectId: "b1", title: "My Task" });
    expect(created.key).toBe("TSK-1");
    expect(created.status).toBe("backlog");

    const fetched = await store.getTask(created.id);
    expect(fetched?.title).toBe("My Task");
    expect((await store.getTaskByKey("TSK-1"))?.id).toBe(created.id);

    const updated = await store.updateTask(created.id, { title: "Renamed", status: "in_progress" });
    expect(updated.title).toBe("Renamed");
    expect(updated.status).toBe("in_progress");
    expect((await store.getTask(created.id))?.status).toBe("in_progress");
  });

  it("deleteTask стирает файл с диска", async () => {
    const created = await store.createTask({ projectId: "b1", title: "Duplicate" });
    const filePath = (await store.getTask(created.id))!.source!.filePath;

    expect(await store.deleteTask(created.id)).toBe(true);
    expect(existsSync(filePath)).toBe(false);
    expect(await store.getTask(created.id)).toBeUndefined();
  });

  it("deleteTask неизвестной задачи отвечает false", async () => {
    expect(await store.deleteTask("b1:nothing")).toBe(false);
  });

  it("второй createTask получает следующий номер ключа", async () => {
    await store.createTask({ projectId: "b1", title: "First" });
    const second = await store.createTask({ projectId: "b1", title: "Second" });
    expect(second.key).toBe("TSK-2");
  });

  it("листает и фильтрует задачи по статусу", async () => {
    await store.createTask({ projectId: "b1", title: "A", status: "todo" });
    await store.createTask({ projectId: "b1", title: "B", status: "done" });
    expect(await store.listTasks({ statuses: ["done"] })).toHaveLength(1);
    expect(await store.listTasks({})).toHaveLength(2);
  });

  it("comments: создаёт, листает, обновляет, удаляет", async () => {
    const task = await store.createTask({ projectId: "b1", title: "T" });
    const comment = await store.createComment({ taskId: task.id, kind: "user", authorName: "Alice", body: "Hi" });
    expect(await store.listComments(task.id)).toHaveLength(1);

    await store.updateComment(comment.id, { body: "Edited" });
    expect((await store.getComment(comment.id))?.body).toBe("Edited");

    await store.deleteComment(comment.id);
    expect(await store.listComments(task.id)).toHaveLength(0);
  });

  it("labels: добавляет и убирает имя метки на задаче", async () => {
    const task = await store.createTask({ projectId: "b1", title: "T" });
    await store.addTaskLabel(task.id, "frontend");
    expect((await store.getTask(task.id))?.labelIds).toEqual(["frontend"]);
    await store.removeTaskLabel(task.id, "frontend");
    expect((await store.getTask(task.id))?.labelIds).toEqual([]);
  });

  it("threads: в файл уходит только факт привязки, без состояния треда", async () => {
    const task = await store.createTask({ projectId: "b1", title: "T" });
    await store.upsertTaskThread({ taskId: task.id, threadId: "thr_x", presetName: "Opus", title: "Work" });

    const file = readFileSync((await store.getTask(task.id))!.source!.filePath, "utf8");
    expect(file).toContain("threadId: thr_x");
    expect(file).toContain("attachedAt:");
    for (const volatile of ["liveStatus", "archivedAt", "updatedAt", "taskId"]) {
      expect(file).not.toContain(`${volatile}:`);
    }
  });

  it("threads: живой статус читается из памяти процесса, а не из файла", async () => {
    const task = await store.createTask({ projectId: "b1", title: "T" });
    await store.upsertTaskThread({ taskId: task.id, threadId: "thr_x", presetName: "Opus", title: "Work" });
    expect((await store.getTaskThreadByThreadId(task.id, "thr_x"))?.liveStatus).toBe("idle");

    store.setThreadLiveState("thr_x", { liveStatus: "working", archivedAt: null });
    expect((await store.getTaskThreadByThreadId(task.id, "thr_x"))?.liveStatus).toBe("working");
    expect(store.getThreadLiveState("thr_x")).toEqual({ liveStatus: "working", archivedAt: null });
  });

  it("threads: смена состояния треда не переписывает файл задачи", async () => {
    const task = await store.createTask({ projectId: "b1", title: "T" });
    await store.upsertTaskThread({ taskId: task.id, threadId: "thr_x", presetName: "Opus", title: "Work" });
    const filePath = (await store.getTask(task.id))!.source!.filePath;
    const before = readFileSync(filePath, "utf8");

    store.setThreadLiveState("thr_x", { liveStatus: "working", archivedAt: null });
    store.setThreadLiveState("thr_x", { liveStatus: "completed", archivedAt: "2026-01-01T00:00:00.000Z" });

    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("threads: liveStatus, оставшийся в файле от старой версии, игнорируется", async () => {
    const task = await store.createTask({ projectId: "b1", title: "T" });
    const filePath = (await store.getTask(task.id))!.source!.filePath;
    writeFileSync(
      filePath,
      readFileSync(filePath, "utf8").replace(
        "---\n\n",
        "threads:\n  - id: th1\n    threadId: thr_old\n    liveStatus: working\n    updatedAt: 2026-01-01T00:00:00.000Z\n---\n\n",
      ),
    );

    expect((await store.getTaskThreadByThreadId(task.id, "thr_old"))?.liveStatus).toBe("idle");
  });

  it("activeOnly: только задачи со стартующим/работающим тредом", async () => {
    const active = await store.createTask({ projectId: "b1", title: "Active" });
    const idle = await store.createTask({ projectId: "b1", title: "Idle" });
    const none = await store.createTask({ projectId: "b1", title: "None" });
    await store.upsertTaskThread({ taskId: active.id, threadId: "thr_a", presetName: "P", title: "T" });
    await store.upsertTaskThread({ taskId: idle.id, threadId: "thr_i", presetName: "P", title: "T" });
    store.setThreadLiveState("thr_a", { liveStatus: "working", archivedAt: null });
    store.setThreadLiveState("thr_i", { liveStatus: "idle", archivedAt: null });

    const result = await store.listTasks({ activeOnly: true });
    expect(result.map((t) => t.id)).toEqual([active.id]);
    void none;
  });

  it("waitingOnly: только задачи с idle-тредом, не архивным", async () => {
    const waiting = await store.createTask({ projectId: "b1", title: "Waiting" });
    const archived = await store.createTask({ projectId: "b1", title: "Archived" });
    const working = await store.createTask({ projectId: "b1", title: "Working" });
    await store.upsertTaskThread({ taskId: waiting.id, threadId: "thr_w", presetName: "P", title: "T" });
    await store.upsertTaskThread({ taskId: archived.id, threadId: "thr_x", presetName: "P", title: "T" });
    await store.upsertTaskThread({ taskId: working.id, threadId: "thr_g", presetName: "P", title: "T" });
    store.setThreadLiveState("thr_w", { liveStatus: "idle", archivedAt: null });
    store.setThreadLiveState("thr_x", { liveStatus: "idle", archivedAt: "2026-01-01T00:00:00.000Z" });
    store.setThreadLiveState("thr_g", { liveStatus: "working", archivedAt: null });

    const result = await store.listTasks({ waitingOnly: true });
    expect(result.map((t) => t.id)).toEqual([waiting.id]);
  });

  it("threadsByTaskId: один проход по доске, треды сгруппированы по задаче", async () => {
    const task1 = await store.createTask({ projectId: "b1", title: "One" });
    const task2 = await store.createTask({ projectId: "b1", title: "Two" });
    await store.upsertTaskThread({ taskId: task1.id, threadId: "thr_1", presetName: "P", title: "T" });

    const map = await store.threadsByTaskId("b1");
    expect(map.get(task1.id)?.map((t) => t.threadId)).toEqual(["thr_1"]);
    expect(map.get(task2.id) ?? []).toEqual([]);
  });

  it("attachments: создаёт и удаляет, привязанные к задаче", async () => {
    const task = await store.createTask({ projectId: "b1", title: "T" });
    const attachment = await store.createAttachment({
      taskId: task.id, fileName: "a.png", mime: "image/png", sizeBytes: 10, blobPath: "blobs/a.png", isImage: true,
    });
    expect(await store.listAttachmentsForTask(task.id)).toHaveLength(1);
    await store.deleteAttachment(attachment.id);
    expect(await store.listAttachmentsForTask(task.id)).toHaveLength(0);
  });

  it("subtasks: parentTaskId связывает и считается в done-счётчике", async () => {
    const parent = await store.createTask({ projectId: "b1", title: "Parent" });
    const child = await store.createTask({ projectId: "b1", title: "Child", parentTaskId: parent.id, status: "done" });
    expect((await store.listSubtasks(parent.id)).map((t) => t.id)).toEqual([child.id]);
    expect(await store.getSubtaskDoneCounts(parent.id)).toEqual({ total: 1, done: 1 });
  });

  it("сохраняет задачу и её комментарии между независимыми чтениями (переживает перезапуск)", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Persisted" });
    await store.createComment({ taskId: task.id, kind: "user", authorName: "A", body: "hi" });

    const freshStore = createFileTasksStore(kv, [board], [], [], [], () => {});
    freshStore.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
    expect((await freshStore.getTask(task.id))?.title).toBe("Persisted");
    expect(await freshStore.listComments(task.id)).toHaveLength(1);
  });
});

/** A file written by hand: no `key`, so the board addresses it by its slug. */
function writeKeylessFile(status: string, slug: string, frontmatter: string, body = "Body."): string {
  mkdirSync(join(root, status), { recursive: true });
  const filePath = join(root, status, `${slug}.md`);
  writeFileSync(filePath, `---\n${frontmatter}\n---\n\n${body}\n`);
  return filePath;
}

describe("адресация: ключ, слаг, файловый id", () => {
  it("задачу с ключом находит и по её слагу", async () => {
    const created = await store.createTask({ projectId: "b1", title: "Find Me" });
    expect((await store.getTaskByKey("find-me"))?.id).toBe(created.id);
    expect((await store.getTaskByKey("FIND-ME"))?.id).toBe(created.id);
  });

  it("бесключевой файл находит по слагу, ключ у него — слаг, номера нет", async () => {
    writeKeylessFile("backlog", "hand-written", "title: Hand written");
    const task = await store.getTaskByKey("hand-written");
    expect(task?.id).toBe("b1:hand-written");
    expect(task?.key).toBe("hand-written");
    expect(task?.number).toBeNull();
  });
});

describe("смена слага", () => {
  it("файл переезжает под новое имя, id меняется, ключ и комментарии остаются", async () => {
    const created = await store.createTask({ projectId: "b1", title: "Old Name", status: "todo" });
    await store.createComment({ taskId: created.id, kind: "user", authorName: "A", body: "kept" });
    const oldPath = (await store.getTask(created.id))!.source!.filePath;

    const renamed = await store.updateTask(created.id, { slug: "new-name" });

    expect(renamed.id).toBe("b1:new-name");
    expect(renamed.key).toBe("TSK-1");
    expect(renamed.source?.filePath).toBe(join(root, "todo", "new-name.md"));
    expect(existsSync(oldPath)).toBe(false);
    expect(await store.getTask(created.id)).toBeUndefined();
    expect((await store.listComments("b1:new-name")).map((c) => c.body)).toEqual(["kept"]);
    expect(readFileSync(renamed.source!.filePath, "utf8")).toContain("slug: new-name");
  });

  it("переименование бесключевого родителя в main не сиротит детей: он получает ключ, дети идут за ним", async () => {
    writeKeylessFile("backlog", "parent-old", "title: Parent");
    writeKeylessFile("backlog", "child", "title: Child\nparent: parent-old");
    expect((await store.getTask("b1:child"))?.parentTaskId).toBe("b1:parent-old");

    const renamed = await store.updateTask("b1:parent-old", { slug: "parent-new" });

    expect(renamed.key).toBe("TSK-1");
    expect((await store.getTask("b1:child"))?.parentTaskId).toBe("b1:parent-new");
    expect(readFileSync(join(root, "backlog", "child.md"), "utf8")).toContain("parent: TSK-1");
  });

  it("занятый слаг отвергается, файлы не трогаются", async () => {
    const a = await store.createTask({ projectId: "b1", title: "A" });
    await store.createTask({ projectId: "b1", title: "B" });
    await expect(store.updateTask(a.id, { slug: "b" })).rejects.toThrow(/slug .* already/);
    expect((await store.getTask(a.id))?.title).toBe("A");
  });

  it("слаг с разделителем пути или пустой отвергается", async () => {
    const a = await store.createTask({ projectId: "b1", title: "A" });
    await expect(store.updateTask(a.id, { slug: "../escape" })).rejects.toThrow(/slug/);
    await expect(store.updateTask(a.id, { slug: "has space" })).rejects.toThrow(/slug/);
    await expect(store.updateTask(a.id, { slug: "  " })).rejects.toThrow(/slug/);
  });

  it("тот же слаг — не переименование: файл на месте", async () => {
    const a = await store.createTask({ projectId: "b1", title: "Same" });
    const same = await store.updateTask(a.id, { slug: "same", title: "Same still" });
    expect(same.id).toBe(a.id);
    expect(existsSync(join(root, "backlog", "same.md"))).toBe(true);
  });
});

describe("смена ключа", () => {
  it("бесключевой файл получает ключ и номер и находится по ключу", async () => {
    writeKeylessFile("backlog", "no-key", "title: No key");
    const keyed = await store.updateTask("b1:no-key", { key: "tsk-40" });

    expect(keyed.key).toBe("TSK-40");
    expect(keyed.number).toBe(40);
    expect((await store.getTaskByKey("TSK-40"))?.id).toBe("b1:no-key");
    expect(readFileSync(join(root, "backlog", "no-key.md"), "utf8")).toContain("key: TSK-40");
  });

  it("после выданного ключа счётчик новых задач идёт дальше него", async () => {
    writeKeylessFile("backlog", "no-key", "title: No key");
    await store.updateTask("b1:no-key", { key: "TSK-40" });
    expect((await store.createTask({ projectId: "b1", title: "Next" })).key).toBe("TSK-41");
  });

  it("снятие ключа в main отвергается с внятной причиной, файл не трогается", async () => {
    const created = await store.createTask({ projectId: "b1", title: "Keyed" });

    await expect(store.updateTask(created.id, { key: null })).rejects.toThrow(
      /снять ключ можно только у задачи, живущей в ветке/,
    );
    expect((await store.getTaskByKey("TSK-1"))?.id).toBe(created.id);
    expect(readFileSync(created.source!.filePath, "utf8")).toMatch(/^key: TSK-1$/m);
  });

  it("занятый ключ и ключ не по формату отвергаются", async () => {
    await store.createTask({ projectId: "b1", title: "First" });
    const second = await store.createTask({ projectId: "b1", title: "Second" });
    await expect(store.updateTask(second.id, { key: "TSK-1" })).rejects.toThrow(/key .* already/);
    await expect(store.updateTask(second.id, { key: "not a key" })).rejects.toThrow(/key/);
    expect((await store.getTask(second.id))?.key).toBe("TSK-2");
  });

  it("дети переадресуются на новый ключ родителя", async () => {
    const parent = await store.createTask({ projectId: "b1", title: "Parent" });
    const child = await store.createTask({ projectId: "b1", title: "Child", parentTaskId: parent.id });

    await store.updateTask(parent.id, { key: "TSK-100" });

    expect((await store.getTask(child.id))?.parentTaskId).toBe(parent.id);
    expect(readFileSync((await store.getTask(child.id))!.source!.filePath, "utf8")).toContain("parent: TSK-100");
  });

  it("правка бесключевой задачи в main вписывает выданный доской ключ, а не слаг", async () => {
    writeKeylessFile("backlog", "no-key", "title: No key");
    await store.updateTask("b1:no-key", { title: "Edited" });
    const file = readFileSync(join(root, "backlog", "no-key.md"), "utf8");
    expect(file).toMatch(/^key: TSK-1$/m);
    expect(file).not.toMatch(/^key: no-key$/m);
  });
});

describe("boards/folders/presets/saved views", () => {
  it("folder CRUD", () => {
    const folder = store.createFolder({ name: "Grp" });
    expect(store.getFolder(folder.id)?.name).toBe("Grp");
    store.updateFolder(folder.id, { name: "Renamed" });
    expect(store.getFolder(folder.id)?.name).toBe("Renamed");
    expect(store.deleteFolder(folder.id)).toBe(true);
  });

  it("project CRUD", () => {
    const project = store.createProject({ name: "New", prefix: "NEW", color: "red" });
    expect(store.getProject(project.id)?.prefix).toBe("NEW");
    store.updateProject(project.id, { color: "green" });
    expect(store.getProject(project.id)?.color).toBe("green");
    expect(store.deleteProject(project.id)).toBe(true);
  });

  it("updateProject с явными undefined в полях не затирает их (так шлёт CLI --rename-prefix)", () => {
    const project = store.createProject({
      name: "Keep", prefix: "OLD", color: "red", linkedBbProjectId: "proj_x", tasksFolder: "memory/tasks",
    });
    const updated = store.updateProject(project.id, {
      prefix: "NEW", name: undefined, color: undefined, folderId: undefined,
      linkedBbProjectId: undefined, tasksFolder: undefined,
    });
    expect(updated).toMatchObject({
      prefix: "NEW", name: "Keep", color: "red", folderId: null,
      linkedBbProjectId: "proj_x", tasksFolder: "memory/tasks",
    });
    expect(Object.values(updated)).not.toContain(undefined);
    expect(JSON.parse(JSON.stringify(store.getProject(project.id)))).toMatchObject({ name: "Keep", tasksFolder: "memory/tasks" });
  });

  it("preset и saved-view CRUD", () => {
    const preset = store.createPreset({
      name: "P", providerId: "claude", modelId: "opus", reasoningLevel: "high",
      permissionMode: "default" as never, environmentKind: "project-default", baseBranch: null, machineId: null, instructions: "",
    });
    expect(store.listPresets()).toHaveLength(1);
    store.deletePreset(preset.id);
    expect(store.listPresets()).toHaveLength(0);

    const view = store.createSavedView({ scope: "board", name: "V", config: {} as never });
    expect(store.listSavedViews("board")).toHaveLength(1);
    store.deleteSavedView(view.id);
    expect(store.listSavedViews("board")).toHaveLength(0);
  });

  it("вид, сохранённый до замены токенов, отдаётся без поля tokens", () => {
    store.createSavedView({
      scope: "all",
      name: "Old",
      config: {
        fields: [
          { field: "tokens", visible: true },
          { field: "labels", visible: true },
        ],
        showEmpty: false,
        showDescription: false,
      } as never,
    });
    const [view] = store.listSavedViews("all");
    expect(view!.config.fields).toEqual([{ field: "labels", visible: true }]);
  });

  it("задача хранит время и деньги, пустое значение стирает поле", async () => {
    const created = await store.createTask({
      projectId: "b1",
      title: "Priced",
      plannedMinutes: 90,
      budget: 34.1,
      budgetLimit: 60,
    });
    expect(created).toMatchObject({ plannedMinutes: 90, actualMinutes: null, budget: 34.1, budgetLimit: 60, cost: null });

    const updated = await store.updateTask(created.id, { actualMinutes: 120, cost: 12.345, budgetLimit: null });
    expect(updated).toMatchObject({ plannedMinutes: 90, actualMinutes: 120, budget: 34.1, budgetLimit: null, cost: 12.35 });

    const text = readFileSync((await store.getTask(created.id))!.source!.filePath, "utf8");
    expect(text).toContain("minutes_actual: 120");
    expect(text).toContain("cost: 12.35");
    expect(text).not.toContain("limit:");
  });

  it("значение времени или денег, которое плагин не прочитал, переживает постороннюю запись", async () => {
    const created = await store.createTask({ projectId: "b1", title: "Hand priced" });
    const filePath = (await store.getTask(created.id))!.source!.filePath;
    writeFileSync(filePath, readFileSync(filePath, "utf8").replace("title: Hand priced", "title: Hand priced\nminutes: 1h 30m\ncost: 12.5 USD"));

    await store.createComment({ taskId: created.id, kind: "user", authorName: "A", body: "hi" });
    await store.updateTask(created.id, { status: "todo", budget: 10 });

    const text = readFileSync((await store.getTask(created.id))!.source!.filePath, "utf8");
    expect(text).toContain("minutes: 1h 30m");
    expect(text).toContain("cost: 12.5 USD");
    expect(text).toContain("budget: 10");
  });

  it("явный null снимает и нечитаемое значение", async () => {
    const created = await store.createTask({ projectId: "b1", title: "Cleared" });
    const filePath = (await store.getTask(created.id))!.source!.filePath;
    writeFileSync(filePath, readFileSync(filePath, "utf8").replace("title: Cleared", "title: Cleared\nminutes: 1h 30m"));

    await store.updateTask(created.id, { plannedMinutes: null });

    expect(readFileSync((await store.getTask(created.id))!.source!.filePath, "utf8")).not.toContain("minutes:");
  });

  it("отвергает отрицательное время и дробные минуты", async () => {
    await expect(store.createTask({ projectId: "b1", title: "Bad", plannedMinutes: 1.5 })).rejects.toThrow(/plannedMinutes/);
    await expect(store.createTask({ projectId: "b1", title: "Bad", cost: -1 })).rejects.toThrow(/cost/);
  });
});

describe("board without resolved roots", () => {
  it("createTask throws instead of writing to the process cwd", async () => {
    const freshBoard: BoardConfig = { ...board, id: "b2" };
    const freshStore = createFileTasksStore(fakeKv(), [freshBoard], [], [], [], () => {});
    // setBoardRoots deliberately not called for this board.
    await expect(freshStore.createTask({ projectId: "b2", title: "X" })).rejects.toThrow(
      /no resolved checkout path/,
    );
  });
});

describe("корень запроса: main плюс дерево вызвавшего треда", () => {
  let worktree: string;
  let caller: CallerEnvironment | null;
  let linked: BoardConfig;
  let linkedStore: ReturnType<typeof createFileTasksStore>;

  function worktreeCaller(environmentId = "env_1", path?: string): CallerEnvironment {
    return {
      environmentId,
      projectId: "proj_x",
      path: path ?? worktree,
      name: "wt",
      branchName: `bb/${environmentId}`,
      isWorktree: true,
      hostId: "host_1",
    };
  }

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), "store-wt-"));
    caller = null;
    linked = { ...board, id: "b2", linkedBbProjectId: "proj_x", tasksFolder: "tasks" };
    linkedStore = createFileTasksStore(fakeKv(), [linked], [], [], [], () => {}, () => caller);
    linkedStore.setBoardRoots("b2", [{ absPath: root, origin: { kind: "main" } }]);
  });
  afterEach(() => rmSync(worktree, { recursive: true, force: true }));

  const wtRoot = () => join(worktree, "tasks");
  const fileOf = (task: { source?: { filePath: string } | null }) =>
    readFileSync(task.source!.filePath, "utf8");

  it("задача из треда в worktree создаётся в его дереве, main не трогается", async () => {
    caller = worktreeCaller();
    const created = await linkedStore.createTask({ projectId: "b2", title: "In worktree" });
    expect(created.source?.filePath).toBe(join(wtRoot(), "backlog", "in-worktree.md"));
    expect(created.source?.origin).toEqual({
      kind: "worktree",
      environmentId: "env_1",
      name: "wt",
      branchName: "bb/env_1",
    });
    expect(existsSync(join(root, "backlog"))).toBe(false);
  });

  it("задача из треда в главном чекауте и из интерфейса доски создаётся в main", async () => {
    caller = { ...worktreeCaller(), isWorktree: false };
    const fromMainThread = await linkedStore.createTask({ projectId: "b2", title: "A" });
    caller = null;
    const fromBoard = await linkedStore.createTask({ projectId: "b2", title: "B" });
    expect(fromMainThread.source?.filePath).toBe(join(root, "backlog", "a.md"));
    expect(fromBoard.source?.filePath).toBe(join(root, "backlog", "b.md"));
    expect(existsSync(join(wtRoot(), "backlog"))).toBe(false);
  });

  it("тред в worktree читает только своё дерево, доска — только main", async () => {
    caller = null;
    const inMain = await linkedStore.createTask({ projectId: "b2", title: "Main task" });
    caller = worktreeCaller();
    const inBranch = await linkedStore.createTask({ projectId: "b2", title: "Worktree task" });

    // Задача, заведённая на доске, в дерево ветки не приезжает сама — туда её
    // приносит git. Поэтому из треда видно ровно то, что лежит в его дереве.
    expect((await linkedStore.listTasks({ projectId: "b2" })).map((t) => t.title)).toEqual([
      "Worktree task",
    ]);
    expect((await linkedStore.getTask(inBranch.id))?.title).toBe("Worktree task");
    expect(await linkedStore.getTask(inMain.id)).toBeUndefined();

    caller = null;
    expect((await linkedStore.listTasks({ projectId: "b2" })).map((t) => t.title)).toEqual([
      "Main task",
    ]);
    expect(await linkedStore.getTask(inBranch.id)).toBeUndefined();
    expect((await linkedStore.getTask(inMain.id))?.title).toBe("Main task");

    caller = worktreeCaller("env_2", mkdtempSync(join(tmpdir(), "store-other-wt-")));
    expect(await linkedStore.listTasks({ projectId: "b2" })).toEqual([]);
  });

  it("смена статуса переименовывает файл внутри дерева, копии в main не появляется", async () => {
    caller = worktreeCaller();
    const created = await linkedStore.createTask({ projectId: "b2", title: "Follow" });
    await linkedStore.updateTask(created.id, { status: "in_progress" });
    await linkedStore.createComment({ taskId: created.id, kind: "agent", authorName: "a", body: "hi" });

    const task = (await linkedStore.getTask(created.id))!;
    expect(task.source?.filePath).toBe(join(wtRoot(), "in_progress", "follow.md"));
    expect(readFileSync(task.source!.filePath, "utf8")).toContain("hi");
    expect(existsSync(join(wtRoot(), "backlog", "follow.md"))).toBe(false);
    expect(existsSync(join(root, "backlog"))).toBe(false);
    expect(existsSync(join(root, "in_progress"))).toBe(false);
  });

  // Дерево ветки — полная копия репозитория: файл задачи из main лежит и в
  // нём, а после того как main ушёл вперёд, копии расходятся. Задача от
  // этого не должна ни двоиться в списке, ни менять место записи.
  it("задача, живущая в обоих деревьях, из треда читается и правится в его дереве", async () => {
    caller = null;
    const shared = await linkedStore.createTask({ projectId: "b2", title: "Shared" });
    mkdirSync(join(wtRoot(), "backlog"), { recursive: true });
    writeFileSync(
      join(wtRoot(), "backlog", "shared.md"),
      readFileSync(join(root, "backlog", "shared.md"), "utf8").replace(
        "Shared",
        "Shared (копия ветки)",
      ),
    );
    caller = worktreeCaller();

    expect((await linkedStore.listTasks({ projectId: "b2" })).map((t) => t.title)).toEqual([
      "Shared (копия ветки)",
    ]);
    await linkedStore.updateTask(shared.id, { status: "in_progress" });
    expect(existsSync(join(wtRoot(), "in_progress", "shared.md"))).toBe(true);
    expect(existsSync(join(wtRoot(), "backlog", "shared.md"))).toBe(false);
    // Главный чекаут не тронут: правка из ветки в него не приходит.
    expect(existsSync(join(root, "backlog", "shared.md"))).toBe(true);
    expect(existsSync(join(root, "in_progress", "shared.md"))).toBe(false);
  });

  // Ключ — имя задачи на доске, а доска видит задачу только после
  // слияния: рождённая в ветке живёт без ключа и получает его, когда
  // попадает в main (BBPL-294).
  it("задача из ветки рождается без ключа: в файле нет поля key, ключом служит слаг", async () => {
    caller = worktreeCaller();
    const created = await linkedStore.createTask({ projectId: "b2", title: "Branch born" });
    expect(created.number).toBeNull();
    expect(created.key).toBe("branch-born");
    expect(fileOf(created)).not.toMatch(/^key:/m);
  });

  it("задача, созданная в main, ключ получает сразу", async () => {
    const created = await linkedStore.createTask({ projectId: "b2", title: "Main born" });
    expect(created.key).toBe("TSK-1");
    expect(fileOf(created)).toMatch(/^key: TSK-1$/m);
  });

  it("первая правка бесключевой задачи в main чеканит следующий свободный номер, вторая его не трогает", async () => {
    await linkedStore.createTask({ projectId: "b2", title: "Taken" });
    caller = worktreeCaller();
    const born = await linkedStore.createTask({ projectId: "b2", title: "Landed" });
    // ветка влилась: файл лежит в main, ключа у него по-прежнему нет
    mkdirSync(join(root, "backlog"), { recursive: true });
    writeFileSync(join(root, "backlog", "landed.md"), fileOf(born));
    rmSync(join(wtRoot(), "backlog", "landed.md"));
    caller = null;

    const stamped = await linkedStore.updateTask(born.id, { status: "in_progress" });
    expect(stamped.key).toBe("TSK-2");
    expect(stamped.id).toBe(born.id);
    expect(fileOf(stamped)).toMatch(/^key: TSK-2$/m);

    const again = await linkedStore.updateTask(born.id, { priority: "high" });
    expect(again.key).toBe("TSK-2");
  });

  it("комментарий к бесключевой задаче в main тоже чеканит ключ — чеканит любая запись", async () => {
    writeKeylessFile("backlog", "hand-written", "title: Hand written");

    await linkedStore.createComment({
      taskId: "b2:hand-written",
      kind: "agent",
      authorName: "a",
      body: "hi",
    });
    expect((await linkedStore.getTask("b2:hand-written"))?.key).toBe("TSK-1");
  });

  it("правка бесключевой задачи, лежащей в ветке, ключа не выдаёт", async () => {
    caller = worktreeCaller();
    const born = await linkedStore.createTask({ projectId: "b2", title: "Still branch" });
    const edited = await linkedStore.updateTask(born.id, { status: "in_progress" });
    expect(edited.number).toBeNull();
    expect(edited.key).toBe("still-branch");
    expect(fileOf(edited)).not.toMatch(/^key:/m);
  });

  it("снять ключ у задачи в main нельзя: имя на доске у неё есть по определению", async () => {
    const created = await linkedStore.createTask({ projectId: "b2", title: "Stamped" });
    await expect(linkedStore.updateTask(created.id, { key: null })).rejects.toThrow(
      /ключ.*main|main.*ключ/i,
    );
    expect(fileOf((await linkedStore.getTask(created.id))!)).toMatch(/^key: TSK-1$/m);
  });

  it("две одновременные записи в одну бесключевую задачу дают ей одно имя", async () => {
    writeKeylessFile("backlog", "landed-once", "title: Landed once");

    const [a, b] = await Promise.all([
      linkedStore.updateTask("b2:landed-once", { status: "todo" }),
      linkedStore.updateTask("b2:landed-once", { priority: "high" }),
    ]);
    expect(a.key).toBe("TSK-1");
    expect(b.key).toBe("TSK-1");
    expect((await linkedStore.getTaskByKey("TSK-1"))?.id).toBe("b2:landed-once");
  });

  it("у бесключевой задачи в main отказ объясняет, что снимать нечего", async () => {
    writeKeylessFile("backlog", "not-yet-named", "title: Not yet named");
    await expect(
      linkedStore.updateTask("b2:not-yet-named", { key: null }),
    ).rejects.toThrow(/снимать нечего/);
  });

  it("снять ключ у задачи, живущей в ветке, можно — доска её ещё не видит", async () => {
    caller = worktreeCaller();
    mkdirSync(join(wtRoot(), "backlog"), { recursive: true });
    writeFileSync(
      join(wtRoot(), "backlog", "keyed-in-branch.md"),
      "---\ntitle: Keyed in branch\nkey: TSK-9\n---\n\nBody.\n",
    );

    const cleared = await linkedStore.updateTask("b2:keyed-in-branch", { key: null });
    expect(cleared.number).toBeNull();
    expect(fileOf(cleared)).not.toMatch(/^key:/m);
    expect(await linkedStore.getTaskByKey("TSK-9")).toBeUndefined();
    expect((await linkedStore.getTaskByKey("keyed-in-branch"))?.id).toBe("b2:keyed-in-branch");
  });

  it("две одновременные записи в бесключевые файлы main получают разные ключи", async () => {
    mkdirSync(join(root, "backlog"), { recursive: true });
    writeKeylessFile("backlog", "first-landed", "title: First landed");
    writeKeylessFile("backlog", "second-landed", "title: Second landed");

    const [a, b] = await Promise.all([
      linkedStore.updateTask("b2:first-landed", { status: "todo" }),
      linkedStore.updateTask("b2:second-landed", { status: "todo" }),
    ]);
    expect([a.key, b.key].sort()).toEqual(["TSK-1", "TSK-2"]);
  });

  it("два одновременных создания в main получают разные ключи и разные файлы", async () => {
    const [a, b] = await Promise.all([
      linkedStore.createTask({ projectId: "b2", title: "Same title" }),
      linkedStore.createTask({ projectId: "b2", title: "Same title" }),
    ]);
    expect([a.key, b.key].sort()).toEqual(["TSK-1", "TSK-2"]);
    expect(a.source?.filePath).not.toBe(b.source?.filePath);
  });

  it("переименование бесключевого родителя в ветке уводит детей за новым слагом, ключа не выдаёт", async () => {
    caller = worktreeCaller();
    mkdirSync(join(wtRoot(), "backlog"), { recursive: true });
    writeFileSync(join(wtRoot(), "backlog", "parent-old.md"), "---\ntitle: Parent\n---\n\nBody.\n");
    writeFileSync(
      join(wtRoot(), "backlog", "kid.md"),
      "---\ntitle: Kid\nparent: parent-old\n---\n\nBody.\n",
    );

    const renamed = await linkedStore.updateTask("b2:parent-old", { slug: "parent-new" });

    expect(renamed.number).toBeNull();
    expect((await linkedStore.getTask("b2:kid"))?.parentTaskId).toBe("b2:parent-new");
    expect(readFileSync(join(wtRoot(), "backlog", "kid.md"), "utf8")).toContain("parent: parent-new");
  });
});

describe("исполнитель и эпик", () => {
  const placedPath = (...segments: string[]) => join(root, ...segments);

  it("задача, созданная с исполнителем и эпиком, ложится в их папку", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Deep", status: "todo", assignee: "Claude", epic: "Tasks+" });

    expect(task).toMatchObject({ assignee: "Claude", epic: "Tasks+" });
    expect(existsSync(placedPath("Claude", "Tasks+", "todo", "deep.md"))).toBe(true);
    expect(await store.getTask(task.id)).toMatchObject({ assignee: "Claude", epic: "Tasks+", status: "todo" });
  });

  it("смена исполнителя и эпика переносит файл: id, ключ, поля и журнал остаются", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Move me", estimate: "m" });
    await store.createComment({ taskId: task.id, kind: "user", authorName: "Alice", body: "Hi" });

    const moved = await store.updateTask(task.id, { assignee: "Claude", epic: "Tasks+" });

    expect(moved).toMatchObject({ id: task.id, key: task.key, assignee: "Claude", epic: "Tasks+", estimate: "m" });
    expect(existsSync(placedPath("backlog", "move-me.md"))).toBe(false);
    expect(existsSync(placedPath("Claude", "Tasks+", "backlog", "move-me.md"))).toBe(true);
    expect(await store.listComments(task.id)).toHaveLength(1);
    expect(readFileSync(moved.source!.filePath, "utf8")).not.toMatch(/assignee:|epic:/);
  });

  it("смена статуса задачи с эпиком остаётся внутри её папок", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Stay", assignee: "Claude", epic: "Tasks+" });

    await store.updateTask(task.id, { status: "done" });

    expect(existsSync(placedPath("Claude", "Tasks+", "done", "stay.md"))).toBe(true);
  });

  it("снятие исполнителя возвращает файл в корень и снимает эпик", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Back", assignee: "Claude", epic: "Tasks+" });

    const back = await store.updateTask(task.id, { assignee: null });

    expect(back).toMatchObject({ assignee: null, epic: null });
    expect(existsSync(placedPath("backlog", "back.md"))).toBe(true);
  });

  it("эпик без исполнителя отвергается, файл не трогается", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Lonely" });

    await expect(store.updateTask(task.id, { epic: "Tasks+" })).rejects.toThrow(/assignee/);
    await expect(store.createTask({ projectId: "b1", title: "Other", epic: "Tasks+" })).rejects.toThrow(/assignee/);
    expect(existsSync(placedPath("backlog", "lonely.md"))).toBe(true);
  });

  it("правка поля задачи в папке эпика не переносит её в корень", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Edit", assignee: "Claude", epic: "Tasks+" });

    await store.updateTask(task.id, { title: "Edited" });
    await store.addTaskLabel(task.id, "ui");

    expect(existsSync(placedPath("Claude", "Tasks+", "backlog", "edit.md"))).toBe(true);
    expect(existsSync(placedPath("backlog", "edit.md"))).toBe(false);
  });

  it("доступные значения — папки, где лежат задачи доски, эпики по исполнителю", async () => {
    await store.createTask({ projectId: "b1", title: "A", assignee: "Claude", epic: "Tasks+" });
    await store.createTask({ projectId: "b1", title: "B", assignee: "Claude", epic: "Flow" });
    await store.createTask({ projectId: "b1", title: "C", assignee: "Sergey" });
    await store.createTask({ projectId: "b1", title: "D" });

    expect(await store.listPlacements("b1")).toEqual({
      assignees: ["Claude", "Sergey"],
      epics: [
        { assignee: "Claude", name: "Flow" },
        { assignee: "Claude", name: "Tasks+" },
      ],
    });
  });
});
