import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";

// The store's own filters are covered in filesync/store.test.ts. What is
// covered here is the seam above them: listTasks builds the store filters by
// listing fields one by one, so a filter the RPC accepts but the handler
// forgets to forward is silently ignored — the whole filter disappears and the
// view falls back to "every task". That is exactly how the Waiting section
// shipped twice: once on the SQL store, once again after the move to files.
const BOARD: BoardConfig = {
  // The RPC contract validates ids as ULIDs, so the board needs a real one.
  id: "01M0T4QGCQ3BYK15NH50AD38RV",
  name: "Board",
  prefix: "TSK",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
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

let root: string;
let tasks: ReturnType<typeof createFileTasksStore>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "list-filters-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function apiStore(): TasksApiStore {
  return {
    tasks,
    // These list-filter tests never read the transition log; a no-op double
    // keeps the store total (real behaviour: db/transition-log.test.ts).
    transitions: { record() {}, range: () => [] },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) =>
      (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: () => false,
    openTaskCount: async () => (await tasks.listTasks({})).length,
    sidebarSummary: async () => [],
  };
}

describe("listTasks RPC filter seam", () => {
  it("forwards every thread filter it accepts", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    registerTasksApi(bb, apiStore());

    const waiting = await tasks.createTask({
      projectId: BOARD.id,
      title: "Idle, not archived",
    });
    const archived = await tasks.createTask({
      projectId: BOARD.id,
      title: "Idle, archived",
    });
    const working = await tasks.createTask({
      projectId: BOARD.id,
      title: "Still working",
    });
    // Never dispatched: the case that leaked into the live Waiting view.
    await tasks.createTask({ projectId: BOARD.id, title: "Never dispatched" });
    // Файл задачи хранит факт привязки треда, а его состояние — память
    // процесса: decisions/tasks-plus-thread-state-is-not-a-file-field.md.
    await tasks.upsertTaskThread({
      taskId: waiting.id,
      threadId: "thr_waiting",
      presetName: "P",
      title: "T",
    });
    tasks.setThreadLiveState("thr_waiting", {
      liveStatus: "idle",
      archivedAt: null,
    });
    await tasks.upsertTaskThread({
      taskId: archived.id,
      threadId: "thr_archived",
      presetName: "P",
      title: "T",
    });
    tasks.setThreadLiveState("thr_archived", {
      liveStatus: "idle",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    await tasks.upsertTaskThread({
      taskId: working.id,
      threadId: "thr_working",
      presetName: "P",
      title: "T",
    });
    tasks.setThreadLiveState("thr_working", {
      liveStatus: "working",
      archivedAt: null,
    });

    const waitingPage = (await harness.callRpc("listTasks", {
      waitingOnly: true,
    })) as { tasks: { title: string }[] };
    expect(waitingPage.tasks.map((task) => task.title)).toEqual([
      "Idle, not archived",
    ]);

    const activePage = (await harness.callRpc("listTasks", {
      activeOnly: true,
    })) as { tasks: { title: string }[] };
    expect(activePage.tasks.map((task) => task.title)).toEqual([
      "Still working",
    ]);

    await harness.dispose();
  });
});
