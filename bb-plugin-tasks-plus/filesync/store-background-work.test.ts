import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

let root: string;
let store: ReturnType<typeof createFileTasksStore>;

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
  root = mkdtempSync(join(tmpdir(), "store-busy-"));
  const board: BoardConfig = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };
  store = createFileTasksStore(fakeKv(), [board], [], [], [], () => {});
  store.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function taskWithIdleThread(threadId: string) {
  const task = await store.createTask({ projectId: "b1", title: threadId });
  await store.upsertTaskThread({ taskId: task.id, threadId, presetName: "P", title: "T" });
  store.setThreadLiveState(threadId, { liveStatus: "idle", archivedAt: null });
  return task;
}

describe("тред, ждущий свой фоновый workflow", () => {
  it("его задача в Active и не в Waiting, а тред на карточке работает", async () => {
    const epic = await taskWithIdleThread("thr_epic");
    const waiting = await taskWithIdleThread("thr_wait");
    store.setBusyThreads(["thr_epic"]);

    expect((await store.listTasks({ activeOnly: true })).map((t) => t.id)).toEqual([epic.id]);
    expect((await store.listTasks({ waitingOnly: true })).map((t) => t.id)).toEqual([waiting.id]);
    expect((await store.listTaskThreads(epic.id)).map((t) => t.liveStatus)).toEqual(["working"]);
    expect((await store.taskCardMeta([epic.id]))[0]!.taskThreads.map((t) => t.liveStatus)).toEqual(["working"]);
  });

  it("workflow кончился — задача вернулась в Waiting", async () => {
    const epic = await taskWithIdleThread("thr_epic");
    store.setBusyThreads(["thr_epic"]);
    store.setBusyThreads([]);

    expect(await store.listTasks({ activeOnly: true })).toEqual([]);
    expect((await store.listTasks({ waitingOnly: true })).map((t) => t.id)).toEqual([epic.id]);
  });

  it("собственный статус хода фоновая работа не переписывает", async () => {
    await taskWithIdleThread("thr_epic");
    store.setBusyThreads(["thr_epic"]);

    expect(store.getThreadLiveState("thr_epic")?.liveStatus).toBe("idle");
  });

  it("отдаёт треды, чья занятость сменилась, — им нужен рефреш", () => {
    expect(store.setBusyThreads(["a", "b"]).sort()).toEqual(["a", "b"]);
    expect(store.setBusyThreads(["b", "c"]).sort()).toEqual(["a", "c"]);
    expect(store.setBusyThreads(["b", "c"])).toEqual([]);
  });
});
