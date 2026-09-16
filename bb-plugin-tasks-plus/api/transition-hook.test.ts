import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";

// A status change flows through the boardMove / updateTask RPC handlers; this
// pins the hook that must drop a row into the transition log every time one
// fires (the store unit is covered in db/transition-log.test.ts — here it is
// the seam between the handler and the log).
const BOARD: BoardConfig = {
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
  root = mkdtempSync(join(tmpdir(), "transition-hook-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function apiStore(transitions: TasksApiStore["transitions"]): TasksApiStore {
  return {
    tasks,
    transitions,
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) => (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: () => false,
    openTaskCount: async () => (await tasks.listTasks({})).length,
    sidebarSummary: async () => [],
  };
}

describe("status transition hook", () => {
  it("records a transition when boardMove changes a task's status", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const transitions = createTransitionLog(bb.storage.database());
    registerTasksApi(bb, apiStore(transitions));

    const task = await tasks.createTask({ projectId: BOARD.id, title: "Move me" });
    const before = Date.now();
    await harness.callRpc("boardMove", { taskId: task.id, status: "in_progress", authorName: "Tester" });

    const rows = transitions.range(before - 1, Date.now() + 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: task.id,
      projectId: BOARD.id,
      toStatus: "in_progress",
      actor: "Tester",
    });
  });

  it("records a transition when updateTask changes a task's status", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const transitions = createTransitionLog(bb.storage.database());
    registerTasksApi(bb, apiStore(transitions));

    const task = await tasks.createTask({ projectId: BOARD.id, title: "Update me" });
    const before = Date.now();
    await harness.callRpc("updateTask", { taskId: task.id, status: "in_review", authorName: "Tester" });

    const rows = transitions.range(before - 1, Date.now() + 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: task.id, toStatus: "in_review", actor: "Tester" });
  });

  it("writes nothing when an update leaves the status unchanged", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const transitions = createTransitionLog(bb.storage.database());
    registerTasksApi(bb, apiStore(transitions));

    const task = await tasks.createTask({ projectId: BOARD.id, title: "Rename only" });
    await harness.callRpc("updateTask", { taskId: task.id, title: "Renamed", authorName: "Tester" });

    expect(transitions.range(0, Date.now() + 1)).toHaveLength(0);
  });
});
