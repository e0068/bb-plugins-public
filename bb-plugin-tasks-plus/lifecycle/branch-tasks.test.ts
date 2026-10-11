import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import type { CallerEnvironment } from "../filesync/caller-root.js";
import { registerLifecycle } from "./index.js";

// Задача, созданная в ветке треда, живёт в дереве этого треда до слияния.
// Active и Waiting — взгляд на то, что идёт сейчас, поэтому они видят её,
// пока её тред работает или ждёт ответа, а доска проекта остаётся на main.

type ThreadEvent = (payload: { thread: Record<string, unknown> }) => void;

let main: string;
let worktree: string;
let kv: KvStore;
let events: Map<string, ThreadEvent>;
let sdkThreads: Map<string, Record<string, unknown>>;

const board: BoardConfig = {
  id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null,
  linkedBbProjectId: "proj_x", tasksFolder: "tasks", database: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

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

function branchEnvironment(): CallerEnvironment {
  return {
    environmentId: "env_w",
    projectId: "proj_x",
    path: worktree,
    name: "wt",
    branchName: "bb/branch",
    isWorktree: true,
    hostId: "host_1",
  };
}

function fakeBb(): BbPluginApi {
  return {
    events: {
      on(name: string, handler: ThreadEvent) {
        events.set(name, handler);
      },
    },
    sdk: {
      threads: {
        async get({ threadId }: { threadId: string }) {
          const thread = sdkThreads.get(threadId);
          if (!thread) throw Object.assign(new Error("gone"), { code: "thread_not_found" });
          return thread;
        },
      },
      environments: {
        async get({ environmentId }: { environmentId: string }) {
          if (environmentId !== "env_w") throw new Error("unknown environment");
          const { path, name, branchName, isWorktree, hostId, projectId } = branchEnvironment();
          return { id: environmentId, projectId, path, name, branchName, isWorktree, hostId };
        },
      },
    },
    background: { service() {} },
    log: { warn() {} },
    realtime: { publish() {} },
  } as unknown as BbPluginApi;
}

/** Хранилище, каким его видит интерфейс доски: без вызывающего треда. */
function boardStore(caller: () => CallerEnvironment | null = () => null): TasksApiStore {
  const tasks = createFileTasksStore(kv, [board], [], [], [], () => {}, caller);
  tasks.setBoardRoots("b1", [{ absPath: main, origin: { kind: "main" } }]);
  return { tasks, transaction: (fn: () => unknown) => Promise.resolve(fn()) } as unknown as TasksApiStore;
}

/** Тред в ветке заводит задачу и привязывается к ней — файл ложится в его дерево. */
async function branchTask(threadId: string, title: string) {
  const fromThread = boardStore(branchEnvironment).tasks;
  const task = await fromThread.createTask({ projectId: "b1", title });
  await fromThread.upsertTaskThread({ taskId: task.id, threadId, presetName: "Opus", title: "Work" });
  return task;
}

function threadRow(id: string, status: string) {
  return { id, status, environmentId: "env_w", archivedAt: null, deletedAt: null };
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never held");
}

const titles = (tasks: readonly { title: string }[]) => tasks.map((task) => task.title);

beforeEach(() => {
  main = mkdtempSync(join(tmpdir(), "branch-main-"));
  worktree = mkdtempSync(join(tmpdir(), "branch-wt-"));
  kv = fakeKv();
  events = new Map();
  sdkThreads = new Map();
});
afterEach(() => {
  rmSync(main, { recursive: true, force: true });
  rmSync(worktree, { recursive: true, force: true });
});

describe("Active и Waiting видят задачи из ветки треда", () => {
  it("задача из ветки работающего треда есть в Active и помечена веткой", async () => {
    await branchTask("thr_w", "Branch task");
    const store = boardStore();
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);

    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });

    await waitFor(async () => (await store.tasks.listTasks({ activeOnly: true })).length > 0);
    const active = await store.tasks.listTasks({ activeOnly: true });
    expect(titles(active)).toEqual(["Branch task"]);
    expect(active[0]!.source?.origin).toMatchObject({ kind: "worktree", branchName: "bb/branch" });
  });

  it("задача из ветки ждущего треда есть в Waiting", async () => {
    await branchTask("thr_w", "Branch task");
    const store = boardStore();
    sdkThreads.set("thr_w", threadRow("thr_w", "idle"));
    await registerLifecycle(fakeBb(), store);

    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    events.get("thread.idle")!({ thread: threadRow("thr_w", "idle") });

    await waitFor(async () => (await store.tasks.listTasks({ waitingOnly: true })).length > 0);
    expect(titles(await store.tasks.listTasks({ waitingOnly: true }))).toEqual(["Branch task"]);
    expect(await store.tasks.listTasks({ activeOnly: true })).toEqual([]);
  });

  it("доска проекта и All tasks по-прежнему показывают только main", async () => {
    await branchTask("thr_w", "Branch task");
    const store = boardStore();
    await store.tasks.createTask({ projectId: "b1", title: "Main task" });
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);

    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await waitFor(async () => (await store.tasks.listTasks({ activeOnly: true })).length > 0);

    expect(titles(await store.tasks.listTasks({}))).toEqual(["Main task"]);
    expect(titles(await store.tasks.listTasks({ projectId: "b1" }))).toEqual(["Main task"]);
  });

  it("задача, лежащая и в main, и в ветке, в Active одна", async () => {
    const store = boardStore();
    const shared = await store.tasks.createTask({ projectId: "b1", title: "Shared" });
    await store.tasks.upsertTaskThread({ taskId: shared.id, threadId: "thr_m", presetName: "Opus", title: "Work" });
    // Ветка — полная копия репозитория: файл задачи main лежит и в её дереве.
    cpSync(main, join(worktree, "tasks"), { recursive: true });
    await boardStore(branchEnvironment).tasks.upsertTaskThread({
      taskId: shared.id, threadId: "thr_w", presetName: "Opus", title: "Branch work",
    });
    sdkThreads.set("thr_m", { ...threadRow("thr_m", "active"), environmentId: null });
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);

    events.get("thread.active")!({ thread: { ...threadRow("thr_m", "active"), environmentId: null } });
    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(titles(await store.tasks.listTasks({ activeOnly: true }))).toEqual(["Shared"]);
  });

  it("после перезапуска плагина задача из ветки работающего треда снова в Active", async () => {
    await branchTask("thr_w", "Branch task");
    const before = boardStore();
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), before);
    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await waitFor(async () => (await before.tasks.listTasks({ activeOnly: true })).length > 0);

    // Перезапуск: память состояния тредов пуста, событий о треде, который
    // уже работает, больше не придёт.
    const restarted = boardStore();
    await registerLifecycle(fakeBb(), restarted);

    expect(titles(await restarted.tasks.listTasks({ activeOnly: true }))).toEqual(["Branch task"]);
  });

  it("тред, привязанный к задаче ветки до обновления плагина, находится по первому событию", async () => {
    // Привязка сделана раньше, чем плагин начал запоминать треды веток:
    // памяти о ней нет, есть только файл в дереве треда.
    await branchTask("thr_w", "Branch task");
    kv = fakeKv();
    const store = boardStore();
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);

    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });

    await waitFor(async () => (await store.tasks.listTasks({ activeOnly: true })).length > 0);
    expect(titles(await store.tasks.listTasks({ activeOnly: true }))).toEqual(["Branch task"]);
  });
  it("задача из ветки работающего треда открывается с доски по id и по слагу", async () => {
    const created = await branchTask("thr_w", "Branch task");
    const store = boardStore();
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);

    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await waitFor(async () => (await store.tasks.listTasks({ activeOnly: true })).length > 0);

    expect((await store.tasks.getTask(created.id))?.title).toBe("Branch task");
    expect((await store.tasks.getTaskByKey(created.key))?.title).toBe("Branch task");
  });
  it("задача, к которой работающий тред привязался уже после первого события, есть в Active", async () => {
    let caller: CallerEnvironment | null = null;
    const store = boardStore(() => caller);
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);
    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Тот же процесс плагина, вызов из треда: задача заводится в его дереве.
    caller = branchEnvironment();
    const task = await store.tasks.createTask({ projectId: "b1", title: "Late task" });
    await store.tasks.upsertTaskThread({ taskId: task.id, threadId: "thr_w", presetName: "Opus", title: "Work" });
    caller = null;

    expect(titles(await store.tasks.listTasks({ activeOnly: true }))).toEqual(["Late task"]);
  });
  it("тред из своей ветки не видит в Active задачи чужих веток", async () => {
    await branchTask("thr_w", "Branch task");
    let caller: CallerEnvironment | null = null;
    const store = boardStore(() => caller);
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);
    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await waitFor(async () => (await store.tasks.listTasks({ activeOnly: true })).length > 0);

    const other = mkdtempSync(join(tmpdir(), "branch-other-"));
    caller = { ...branchEnvironment(), environmentId: "env_o", path: other };
    try {
      expect(await store.tasks.listTasks({ activeOnly: true })).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("задачу ветки с доски можно открыть, но не править: файл в дереве треда не меняется", async () => {
    const created = await branchTask("thr_w", "Branch task");
    const store = boardStore();
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);
    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await waitFor(async () => (await store.tasks.listTasks({ activeOnly: true })).length > 0);
    const filePath = (await store.tasks.getTask(created.id))!.source!.filePath;
    const before = readFileSync(filePath, "utf8");

    await expect(store.tasks.updateTask(created.id, { title: "Renamed" })).rejects.toThrow(/ветк/);
    await expect(
      store.tasks.createComment({ taskId: created.id, kind: "user", authorName: "Owner", body: "Hi" }),
    ).rejects.toThrow(/ветк/);
    expect(await store.tasks.deleteTask(created.id).catch(() => false)).toBe(false);
    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("тред в своём дереве без задач ветки не запоминается и не сверяется на загрузке", async () => {
    const store = boardStore();
    sdkThreads.set("thr_z", threadRow("thr_z", "active"));
    await registerLifecycle(fakeBb(), store);
    events.get("thread.active")!({ thread: threadRow("thr_z", "active") });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(store.tasks.branchThreadIds()).toEqual([]);
    expect(await kv.get("branchThreads")).toBeFalsy();
  });

  it("задача, лежащая и в main, и в ветке, в Active одна — после того как ветка прочитана", async () => {
    const store = boardStore();
    const shared = await store.tasks.createTask({ projectId: "b1", title: "Shared" });
    await store.tasks.upsertTaskThread({ taskId: shared.id, threadId: "thr_m", presetName: "Opus", title: "Work" });
    cpSync(main, join(worktree, "tasks"), { recursive: true });
    await boardStore(branchEnvironment).tasks.upsertTaskThread({
      taskId: shared.id, threadId: "thr_w", presetName: "Opus", title: "Branch work",
    });
    sdkThreads.set("thr_m", { ...threadRow("thr_m", "active"), environmentId: null });
    sdkThreads.set("thr_w", threadRow("thr_w", "active"));
    await registerLifecycle(fakeBb(), store);

    events.get("thread.active")!({ thread: { ...threadRow("thr_m", "active"), environmentId: null } });
    events.get("thread.active")!({ thread: threadRow("thr_w", "active") });
    await waitFor(async () => store.tasks.knowsBranchThread("thr_w"));

    expect(titles(await store.tasks.listTasks({ activeOnly: true }))).toEqual(["Shared"]);
  });

  it("архивный тред уходит из Waiting и не возвращается после перезапуска", async () => {
    await branchTask("thr_w", "Branch task");
    const store = boardStore();
    sdkThreads.set("thr_w", threadRow("thr_w", "idle"));
    await registerLifecycle(fakeBb(), store);
    events.get("thread.idle")!({ thread: threadRow("thr_w", "idle") });
    await waitFor(async () => (await store.tasks.listTasks({ waitingOnly: true })).length > 0);

    const archived = { ...threadRow("thr_w", "idle"), archivedAt: 1_791_000_000_000 };
    sdkThreads.set("thr_w", archived);
    events.get("thread.archived")!({ thread: archived });
    await waitFor(async () => (await store.tasks.listTasks({ waitingOnly: true })).length === 0);

    // Перезапуск после архивации: даже если тред вдруг снова отвечает «idle»,
    // памяти о нём больше нет.
    sdkThreads.set("thr_w", threadRow("thr_w", "idle"));
    const restarted = boardStore();
    await registerLifecycle(fakeBb(), restarted);
    expect(await restarted.tasks.listTasks({ waitingOnly: true })).toEqual([]);
  });
});
