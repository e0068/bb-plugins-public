import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import { createFileTasksStore } from "../filesync/store.js";
import { DatabaseAuthFailed, DatabaseUnreachable } from "../filesync/task-repo.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerLifecycle } from "./index.js";

type ThreadEvent = (payload: { thread: Record<string, unknown> }) => void;

let root: string;
let kv: KvStore;
let board: BoardConfig;
let events: Map<string, ThreadEvent>;
let sdkThreads: Map<string, Record<string, unknown>>;
let services: Map<string, { start(signal: AbortSignal): Promise<void> }>;
let threadReads: string[];

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

/** Only what lifecycle/index.ts actually reaches for: events in, one thread
 *  read, a log and a publish channel that swallow their arguments. */
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
          threadReads.push(threadId);
          const thread = sdkThreads.get(threadId);
          if (!thread) throw Object.assign(new Error("gone"), { code: "thread_not_found" });
          return thread;
        },
      },
    },
    background: {
      service(name: string, service: { start(signal: AbortSignal): Promise<void> }) {
        services.set(name, service);
      },
    },
    log: { warn() {} },
    realtime: { publish() {} },
  } as unknown as BbPluginApi;
}

function makeStore(): TasksApiStore {
  const tasks = createFileTasksStore(kv, [board], [], [], [], () => {});
  tasks.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
  return { tasks, transaction: (fn: () => unknown) => Promise.resolve(fn()) } as unknown as TasksApiStore;
}

/** Считает обращения к доске: одно чтение на доску против чтения на задачу
 *  видно только по числу вызовов, а не по результату. */
function countingStore(store: TasksApiStore) {
  const calls = { threadsByTaskId: 0, listTaskThreads: 0 };
  const tasks = {
    ...store.tasks,
    threadsByTaskId(projectId: string) {
      calls.threadsByTaskId += 1;
      return store.tasks.threadsByTaskId(projectId);
    },
    listTaskThreads(taskId: string) {
      calls.listTaskThreads += 1;
      return store.tasks.listTaskThreads(taskId);
    },
  };
  return { store: { ...store, tasks } as TasksApiStore, calls };
}

/** Событийные обработчики плагина не возвращают промис — тест ждёт их
 *  завершения по наблюдаемому следствию, а не по числу тиков. */
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never held");
}

async function taskWithThread(store: TasksApiStore) {
  const task = await store.tasks.createTask({ projectId: "b1", title: "T" });
  await store.tasks.upsertTaskThread({
    taskId: task.id,
    threadId: "thr_x",
    presetName: "Opus",
    title: "Work",
  });
  return task;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lifecycle-"));
  kv = fakeKv();
  events = new Map();
  sdkThreads = new Map();
  services = new Map();
  threadReads = [];
  board = {
    id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null,
    linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z",
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("thread lifecycle", () => {
  it("статус треда меняется, а файл задачи не переписывается", async () => {
    const store = makeStore();
    const task = await taskWithThread(store);
    sdkThreads.set("thr_x", { id: "thr_x", status: "idle", archivedAt: null, deletedAt: null });
    await registerLifecycle(fakeBb(), store);

    const filePath = (await store.tasks.getTask(task.id))!.source!.filePath;
    const before = readFileSync(filePath, "utf8");

    events.get("thread.active")!({ thread: { id: "thr_x" } });
    events.get("thread.idle")!({ thread: { id: "thr_x" } });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readFileSync(filePath, "utf8")).toBe(before);
    expect((await store.tasks.listTaskThreads(task.id))[0]?.liveStatus).toBe("idle");
  });

  it("архивация треда видна на карточке и тоже не трогает файл", async () => {
    const store = makeStore();
    const task = await taskWithThread(store);
    sdkThreads.set("thr_x", { id: "thr_x", status: "idle", archivedAt: null, deletedAt: null });
    await registerLifecycle(fakeBb(), store);
    const filePath = (await store.tasks.getTask(task.id))!.source!.filePath;
    const before = readFileSync(filePath, "utf8");

    events.get("thread.archived")!({
      thread: { id: "thr_x", status: "idle", archivedAt: 1_756_000_000_000, deletedAt: null },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await store.tasks.listTaskThreads(task.id))[0]?.archivedAt).toBe(
      new Date(1_756_000_000_000).toISOString(),
    );
    expect(readFileSync(filePath, "utf8")).toBe(before);
  });

  it("завершение треда не правит файл задачи", async () => {
    const store = makeStore();
    const task = await taskWithThread(store);
    sdkThreads.set("thr_x", { id: "thr_x", status: "idle", archivedAt: null, deletedAt: null });
    await registerLifecycle(fakeBb(), store);
    const filePath = (await store.tasks.getTask(task.id))!.source!.filePath;
    const before = readFileSync(filePath, "utf8");

    events.get("thread.deleted")!({ thread: { id: "thr_x" } });
    await waitFor(
      async () => (await store.tasks.listTaskThreads(task.id))[0]?.liveStatus === "completed",
    );
    // Запись пошла бы следом за состоянием, а не вместе с ним: тику после
    // наблюдения дано пройти, иначе тест зелёный оттого, что поспешил.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(readFileSync(filePath, "utf8")).toBe(before);
    expect(await store.tasks.listComments(task.id)).toEqual([]);
  });

  it("старт плагина не ждёт сверки: треды у bb не спрашиваются", async () => {
    const store = makeStore();
    await taskWithThread(store);
    sdkThreads.set("thr_x", { id: "thr_x", status: "idle", archivedAt: null, deletedAt: null });

    await registerLifecycle(fakeBb(), store);

    expect(threadReads).toEqual([]);
    expect(services.has("thread-status-reconcile")).toBe(true);
  });

  describe("фоновая сверка", () => {
    /** Запускает сервис сверки и отдаёт способ его остановить; сервис живёт до
     *  отмены сигнала, поэтому тест всегда гасит его сам. */
    async function startReconcile(store: TasksApiStore) {
      await registerLifecycle(fakeBb(), store);
      const controller = new AbortController();
      const running = services.get("thread-status-reconcile")!.start(controller.signal);
      return {
        controller,
        stop: async () => {
          controller.abort();
          await running;
        },
      };
    }

    it("первый проход идёт сразу, без ожидания интервала", async () => {
      const store = makeStore();
      const task = await taskWithThread(store);
      // «active» — единственный статус, который виден как «working»: у треда
      // без наблюдения умолчание «idle», поэтому без сверки разница заметна.
      sdkThreads.set("thr_x", { id: "thr_x", status: "active", archivedAt: null, deletedAt: null });

      // Перезапуск плагина: память состояния пуста, и единственный, кто знает
      // о живых тредах, — сверка в фоне.
      const restarted = makeStore();
      const { stop } = await startReconcile(restarted);
      await waitFor(
        async () => (await restarted.tasks.listTaskThreads(task.id))[0]?.liveStatus === "working",
      );
      await stop();

      expect(threadReads).toEqual(["thr_x"]);
    });

    it.each([
      ["отвергает токен", new DatabaseAuthFailed()],
      ["не отвечает", new DatabaseUnreachable()],
    ])("когда база одной доски %s, треды остальных досок сверяются", async (_, failure) => {
      const store = makeStore();
      const task = await taskWithThread(store);
      sdkThreads.set("thr_x", { id: "thr_x", status: "idle", archivedAt: null, deletedAt: null });
      const tasks = {
        ...store.tasks,
        listProjects: () => [...store.tasks.listProjects(), { ...board, id: "b2" }],
        threadsByTaskId: (projectId: string) =>
          projectId === "b2" ? Promise.reject(failure) : store.tasks.threadsByTaskId(projectId),
      };

      const { stop } = await startReconcile({ ...store, tasks } as TasksApiStore);
      await waitFor(
        async () => (await store.tasks.listTaskThreads(task.id))[0]?.liveStatus === "idle",
      );
      await stop();
    });

    it("число чтений доски за проход сверки не зависит от числа задач", async () => {
      const firstRoot = root;
      const one = countingStore(makeStore());
      await taskWithThread(one.store);
      root = mkdtempSync(join(tmpdir(), "lifecycle-"));
      const many = countingStore(makeStore());
      await taskWithThread(many.store);
      for (const title of ["B", "C", "D", "E"]) {
        await many.store.tasks.createTask({ projectId: "b1", title });
      }
      sdkThreads.set("thr_x", { id: "thr_x", status: "idle", archivedAt: null, deletedAt: null });

      // Один проход на каждую доску: сервис гасится, как только тред прочитан, —
      // проход доводится до конца, следующий не начинается.
      for (const { store } of [one, many]) {
        threadReads = [];
        const { stop } = await startReconcile(store);
        await waitFor(async () => threadReads.length === 1);
        await stop();
      }
      rmSync(firstRoot, { recursive: true, force: true });

      expect(many.calls.threadsByTaskId).toBe(one.calls.threadsByTaskId);
      expect(many.calls.listTaskThreads).toBe(0);
    });

    it("отмена сигнала посреди прохода останавливает дальнейшие чтения тредов", async () => {
      const store = makeStore();
      const task = await taskWithThread(store);
      for (const threadId of ["thr_b", "thr_c", "thr_d"]) {
        await store.tasks.upsertTaskThread({ taskId: task.id, threadId, presetName: "Opus", title: threadId });
      }
      for (const threadId of ["thr_x", "thr_b", "thr_c", "thr_d"]) {
        sdkThreads.set(threadId, { id: threadId, status: "idle", archivedAt: null, deletedAt: null });
      }
      const controller = new AbortController();
      const bb = fakeBb();
      const read = bb.sdk.threads.get.bind(bb.sdk.threads);
      // Сигнал гаснет во время первого чтения: остальные треды читаться не должны.
      bb.sdk.threads.get = async (args) => {
        controller.abort();
        return read(args);
      };

      await registerLifecycle(bb, store);
      await services.get("thread-status-reconcile")!.start(controller.signal);

      expect(threadReads).toHaveLength(1);
    });
  });
});
