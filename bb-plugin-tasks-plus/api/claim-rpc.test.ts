// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksCli } from "../cli/index.js";
import { createStore, registerTasksApi, type TasksApiStore } from "./index.js";

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
  return { get: async (key) => map.get(key) as never, set: async (key, value) => void map.set(key, structuredClone(value)) };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "claim-rpc-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * One machine: its own plugin host and store, reading the same board folder
 * as the other machine — the way two checkouts of one repository do.
 */
function machine(name: string) {
  const create = createFileTasksStore as unknown as (...args: unknown[]) => ReturnType<typeof createFileTasksStore>;
  const tasks = create(fakeKv(), [BOARD], [], [], [], () => {}, () => null, {}, name);
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
  registerTasksCli(bb, store, { name: "Tasks+", version: "test" });
  return { tasks, harness };
}

async function takenOnBook() {
  const book = machine("MacBook");
  const mini = machine("Mac mini");
  const task = await book.tasks.createTask({ projectId: BOARD.id, title: "Glow", status: "todo" });
  const taken = (await book.harness.callRpc("updateTask", { taskId: task.id, status: "in_progress", authorName: "You" })) as { ok: boolean };
  expect(taken.ok).toBe(true);
  return { book, mini, task };
}

describe("a refused take comes back as a result the board and the CLI can show", () => {
  it("updateTask answers task_already_taken with the machine that holds the task", async () => {
    const { mini, task } = await takenOnBook();
    const result = await mini.harness.callRpc("updateTask", { taskId: task.id, status: "in_progress", authorName: "You" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "task_already_taken", takenBy: { machine: "MacBook" } },
    });
    expect((result as { error: { message: string } }).error.message).toMatch(/^TSK-1 is already taken on MacBook/);
  });

  it("a drop into In Progress from a board that still showed the task in Todo is refused the same way", async () => {
    const { mini, task } = await takenOnBook();
    const result = await mini.harness.callRpc("boardMove", { taskId: task.id, status: "in_progress", fromStatus: "todo", authorName: "You" });
    expect(result).toMatchObject({ ok: false, error: { code: "task_already_taken", takenBy: { machine: "MacBook" } } });
  });

  it("reordering a held task inside In Progress is only a reorder: not refused, and the task is not rewritten", async () => {
    const { book, mini, task } = await takenOnBook();
    const before = await book.tasks.getTask(task.id);
    const result = await mini.harness.callRpc("boardMove", { taskId: task.id, status: "in_progress", authorName: "You" });
    expect(result).toMatchObject({ ok: true });
    expect((await book.tasks.getTask(task.id))?.updatedAt).toBe(before?.updatedAt);
  });

  it("a task crosses the wire with who took it", async () => {
    const { mini, task } = await takenOnBook();
    const shown = (await mini.harness.callRpc("getTask", { taskId: task.id })) as { task: { takenBy?: { machine: string } } };
    expect(shown.task.takenBy).toMatchObject({ machine: "MacBook" });
  });

  it("bb tasks update --status in_progress on a held task prints the refusal and fails", async () => {
    const { mini } = await takenOnBook();
    const result = await mini.harness.runCli(["update", "TSK-1", "--status", "in_progress"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/TSK-1 is already taken on MacBook/);
  });
});

describe("the machine a store stamps", () => {
  async function stampWith(hosts: { name: string }[]) {
    const { bb } = createFakePluginHost({ pluginId: "tasks", sdk: { hosts: { list: async () => hosts } } as never });
    const store = await createStore(bb);
    const board = store.tasks.createProject({ name: "Board", prefix: "TSK", color: "blue" });
    store.tasks.setBoardRoots(board.id, [{ absPath: root, origin: { kind: "main" } }]);
    const task = await store.tasks.createTask({ projectId: board.id, title: "Hot", status: "in_progress" });
    return (await store.tasks.getTask(task.id))?.takenBy?.machine;
  }

  it("is the name of the only host bb knows", async () => {
    expect(await stampWith([{ name: "Mac mini" }])).toBe("Mac mini");
  });

  it("is the computer's own name when bb knows several hosts", async () => {
    expect(await stampWith([{ name: "Mac mini" }, { name: "MacBook" }])).toBe(hostname());
  });
});
