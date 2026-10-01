import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import type { ClosedWindows } from "../shared/contract.js";
import { registerTasksApi, type TasksApiStore } from ".";

// Over the RPC boundary: callRpc validates the output against the contract
// schema, so a passing call also proves the closings shape is wire-valid.
const BOARD: BoardConfig = {
  id: "01M0T4QGCQ3BYK15NH50AD38RV",
  name: "Board",
  prefix: "TSK",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
  database: null, createdAt: "2026-01-01T00:00:00.000Z",
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
  root = mkdtempSync(join(tmpdir(), "analytics-closed-rpc-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store: TasksApiStore = {
    tasks,
    transitions: createTransitionLog(bb.storage.database()),
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) => (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: () => false,
    openTaskCount: async () => (await tasks.listTasks({})).length,
    sidebarSummary: async () => [],
  };
  registerTasksApi(bb, store, { get: async () => null });
  return { harness };
}

describe("analyticsClosed RPC", () => {
  it("answers every window in one call, each closing with its key, title, project and column", async () => {
    const { harness } = setup();
    const shipped = await tasks.createTask({ projectId: BOARD.id, title: "Shipped" });
    const started = await tasks.createTask({ projectId: BOARD.id, title: "Started" });

    const from = Date.now() - 1;
    await harness.callRpc("boardMove", { taskId: shipped.id, status: "done", authorName: "Me" });
    await harness.callRpc("boardMove", { taskId: started.id, status: "in_progress", authorName: "Me" });
    const to = Date.now() + 1;

    const result = (await harness.callRpc("analyticsClosed", {
      windows: [
        [from - 1000, from, to],
        [from - 5000, to],
      ],
    })) as ClosedWindows;

    expect(result.windows).toHaveLength(2);
    expect(result.windows[0]!.closings).toEqual([
      expect.objectContaining({ taskId: shipped.id, key: shipped.key, title: "Shipped", projectId: BOARD.id, bin: 1 }),
    ]);
    expect(result.windows[1]!.closings.map((closing) => closing.bin)).toEqual([0]);
    expect(result.projects).toEqual([{ id: BOARD.id, name: "Board" }]);
    expect(result.logStartMs).not.toBeNull();
  });

  it("gives a closed task that no longer exists no key to open it by", async () => {
    const { harness } = setup();
    const gone = await tasks.createTask({ projectId: BOARD.id, title: "Gone" });
    const from = Date.now() - 1;
    await harness.callRpc("boardMove", { taskId: gone.id, status: "done", authorName: "Me" });
    await tasks.deleteTask(gone.id);

    const result = (await harness.callRpc("analyticsClosed", { windows: [[from, Date.now() + 1]] })) as ClosedWindows;
    expect(result.windows[0]!.closings).toEqual([expect.objectContaining({ taskId: gone.id, key: null, title: "Deleted task" })]);
  });

  it("reports no log start while no status change was ever recorded", async () => {
    const { harness } = setup();
    const result = (await harness.callRpc("analyticsClosed", { windows: [[0, 1000]] })) as ClosedWindows;
    expect(result).toEqual({ windows: [{ closings: [] }], projects: [{ id: BOARD.id, name: "Board" }], logStartMs: null });
  });
});
