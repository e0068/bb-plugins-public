import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";

// End-to-end over the RPC boundary: callRpc validates every output against the
// contract schema, so these also prove the snapshot/series shapes are wire-valid.
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
  root = mkdtempSync(join(tmpdir(), "analytics-rpc-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const transitions = createTransitionLog(bb.storage.database());
  const store: TasksApiStore = {
    tasks,
    transitions,
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) => (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: () => false,
    openTaskCount: async () => (await tasks.listTasks({})).length,
    sidebarSummary: async () => [],
  };
  registerTasksApi(bb, store);
  return { harness };
}

describe("analyticsSnapshot RPC", () => {
  it("counts the board's tasks by status, summing to the total", async () => {
    const { harness } = setup();
    const a = await tasks.createTask({ projectId: BOARD.id, title: "A" });
    await tasks.createTask({ projectId: BOARD.id, title: "B" });
    await harness.callRpc("boardMove", { taskId: a.id, status: "in_progress", authorName: "Me" });

    const snap = (await harness.callRpc("analyticsSnapshot", { projectId: BOARD.id })) as {
      total: number;
      byStatus: Record<string, number>;
    };
    expect(snap.total).toBe(2);
    expect(snap.byStatus.in_progress).toBe(1);
    expect(snap.byStatus.backlog).toBe(1);
  });
});

describe("analyticsSeries RPC", () => {
  it("returns bucketed transition counts for the window, split by destination status", async () => {
    const { harness } = setup();
    const task = await tasks.createTask({ projectId: BOARD.id, title: "Mover" });

    const from = Date.now();
    await harness.callRpc("boardMove", { taskId: task.id, status: "in_progress", authorName: "Me" });
    await harness.callRpc("boardMove", { taskId: task.id, status: "in_review", authorName: "Me" });
    const to = Date.now() + 1;

    const series = (await harness.callRpc("analyticsSeries", {
      fromMs: from - 1,
      toMs: to,
      binMs: to - from + 2, // one bin spanning the whole window
      projectId: BOARD.id,
    })) as { bins: number[]; total: number[]; byToStatus: Record<string, number[]> };

    expect(series.total.reduce((a, b) => a + b, 0)).toBe(2);
    const sumInto = (status: string) => series.byToStatus[status].reduce((a, b) => a + b, 0);
    expect(sumInto("in_progress")).toBe(1);
    expect(sumInto("in_review")).toBe(1);
  });
});
