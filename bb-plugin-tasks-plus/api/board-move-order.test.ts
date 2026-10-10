import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import { loadTaskOrders } from "../filesync/order-store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";

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
      map.set(key, structuredClone(value));
    },
  };
}

let root: string;
let kv: KvStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "board-move-order-"));
  kv = fakeKv();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function setup() {
  const tasks = createFileTasksStore(kv, [BOARD], [], [], [], () => {}, () => null, await loadTaskOrders(kv));
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
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
  return { tasks, harness };
}

/** Tasks A, B, C created a second apart — the `created:` each file declares — so unordered they list C, B, A. */
async function seed(tasks: Awaited<ReturnType<typeof setup>>["tasks"]) {
  const made = [];
  for (const [index, title] of ["A", "B", "C"].entries()) {
    const task = await tasks.createTask({ projectId: BOARD.id, title, status: "todo" });
    const at = new Date(Date.UTC(2026, 8, 1, 0, 0, index));
    const file = task.source!.filePath;
    writeFileSync(file, readFileSync(file, "utf8").replace(/^created: .*$/m, `created: ${at.toISOString()}`));
    utimesSync(file, at, at);
    made.push(task);
  }
  return made as [(typeof made)[0], (typeof made)[0], (typeof made)[0]];
}

async function titles(harness: Awaited<ReturnType<typeof setup>>["harness"]) {
  const page = (await harness.callRpc("listTasks", { projectId: BOARD.id, limit: 500 })) as {
    tasks: { title: string }[];
  };
  return page.tasks.map((task) => task.title);
}

describe("boardMove keeps the manual order", () => {
  it("lists a card dropped inside its own column between its new neighbours", async () => {
    const { tasks, harness } = await setup();
    const [a, b, c] = await seed(tasks);

    await harness.callRpc("boardMove", { taskId: a.id, status: "todo", beforeTaskId: c.id, afterTaskId: b.id });

    expect(await titles(harness)).toEqual(["C", "A", "B"]);
  });

  it("keeps the order a drop set after the plugin restarts", async () => {
    const first = await setup();
    const [a, , c] = await seed(first.tasks);
    await first.harness.callRpc("boardMove", { taskId: c.id, status: "todo", beforeTaskId: a.id, afterTaskId: null });

    const restarted = await setup();

    expect(await titles(restarted.harness)).toEqual(["B", "A", "C"]);
  });

  it("changes the status and places the card when it drops into another column", async () => {
    const { tasks, harness } = await setup();
    const [a, b] = await seed(tasks);
    await tasks.updateTask(b.id, { status: "done" });

    const result = (await harness.callRpc("boardMove", {
      taskId: a.id,
      status: "done",
      beforeTaskId: null,
      afterTaskId: b.id,
    })) as { ok: boolean; task: { status: string } };

    expect(result.task.status).toBe("done");
    expect(await titles(harness)).toEqual(["C", "A", "B"]);
  });

  it("leaves the order alone for a drop with no neighbours", async () => {
    const { tasks, harness } = await setup();
    const [a] = await seed(tasks);

    await harness.callRpc("boardMove", { taskId: a.id, status: "in_progress" });

    expect(await titles(harness)).toEqual(["C", "B", "A"]);
  });
});
