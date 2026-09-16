import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerLifecycle } from "./index.js";

type ThreadEvent = (payload: { thread: Record<string, unknown> }) => void;

let root: string;
let kv: KvStore;
let board: BoardConfig;
let events: Map<string, ThreadEvent>;
let sdkThreads: Map<string, Record<string, unknown>>;

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
          const thread = sdkThreads.get(threadId);
          if (!thread) throw Object.assign(new Error("gone"), { code: "thread_not_found" });
          return thread;
        },
      },
    },
    background: { service() {} },
    log: { warn() {} },
    realtime: { publish() {} },
  } as unknown as BbPluginApi;
}

function makeStore(): TasksApiStore {
  const tasks = createFileTasksStore(kv, [board], [], [], [], () => {});
  tasks.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
  return { tasks, transaction: (fn: () => unknown) => Promise.resolve(fn()) } as unknown as TasksApiStore;
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
  board = {
    id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null,
    linkedBbProjectId: null, tasksFolder: "tasks", createdAt: "2026-01-01T00:00:00.000Z",
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

  it("отчёт о завершении треда пишется один раз и переживает перезапуск плагина", async () => {
    const first = makeStore();
    const task = await taskWithThread(first);
    sdkThreads.set("thr_x", { id: "thr_x", status: "idle", archivedAt: null, deletedAt: null });
    await registerLifecycle(fakeBb(), first);

    events.get("thread.deleted")!({ thread: { id: "thr_x" } });
    await waitFor(async () =>
      (await first.tasks.listComments(task.id)).some((c) => c.body.includes("completed")),
    );
    const afterFirst = await first.tasks.listComments(task.id);
    expect(afterFirst.filter((c) => c.body.includes("completed"))).toHaveLength(1);

    // Перезапуск: память состояния пуста, реконсиляция видит удалённый тред.
    sdkThreads.delete("thr_x");
    const second = makeStore();
    await registerLifecycle(fakeBb(), second);
    const afterRestart = await second.tasks.listComments(task.id);
    expect(afterRestart.filter((c) => c.body.includes("completed"))).toHaveLength(1);
  });
});
