import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";

// Epic is a task type: a task belongs to the epic that is its nearest
// ancestor typed epic, at any depth, with no assignee needed.

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

type RpcTask = { id: string; key: string; type: string | null; parentTaskId: string | null; epicId?: string | null; source?: { filePath: string } };

let root: string;
let call: (name: string, input: unknown) => Promise<unknown>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "epic-type-rpc-"));
  const tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
  const store: TasksApiStore = {
    tasks,
    transitions: { record() {}, range: () => [], firstAtMs: () => null },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async () => 0,
    projectPrefixExists: () => false,
    openTaskCount: async () => 0,
    sidebarSummary: async () => [],
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  registerTasksApi(bb, store, { get: async () => null });
  call = (name, input) => harness.behavior.callRpc(name, input);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const create = async (input: Record<string, unknown>) =>
  ((await call("createTask", { projectId: BOARD.id, ...input })) as { task: RpcTask }).task;
const get = async (taskId: string) => ((await call("getTask", { taskId })) as { task: RpcTask }).task;

describe("epic as a task type", () => {
  it("creates a task typed epic, without an assignee, and writes the type to its file", async () => {
    const epic = await create({ title: "Flow", type: "epic" });
    expect(epic.type).toBe("epic");
    expect(readFileSync(epic.source!.filePath, "utf8")).toMatch(/^type: epic$/m);
  });

  it("gives every task the nearest ancestor typed epic, at any depth", async () => {
    const epic = await create({ title: "Flow", type: "epic" });
    const bug = await create({ title: "Bug", type: "bugfix", parentTaskId: epic.id });
    const plain = await create({ title: "Plain", parentTaskId: bug.id });
    const inner = await create({ title: "Inner", type: "epic", parentTaskId: plain.id });
    const leaf = await create({ title: "Leaf", parentTaskId: inner.id });
    const alone = await create({ title: "Alone" });

    expect((await get(plain.id)).epicId).toBe(epic.id);
    expect((await get(inner.id)).epicId).toBe(epic.id);
    expect((await get(leaf.id)).epicId).toBe(inner.id);
    expect((await get(epic.id)).epicId).toBeNull();
    expect((await get(alone.id)).epicId).toBeNull();
  });

  it("changing a task's type leaves its children's parent alone", async () => {
    const epic = await create({ title: "Flow", type: "epic" });
    const child = await create({ title: "Child", parentTaskId: epic.id });
    await call("updateTask", { taskId: epic.id, type: "feature" });
    const after = await get(child.id);
    expect(after.parentTaskId).toBe(epic.id);
    expect(after.epicId).toBeNull();
  });

  it("refuses a parent that is the task itself or one of its descendants", async () => {
    const top = await create({ title: "Top", type: "epic" });
    const mid = await create({ title: "Mid", parentTaskId: top.id });
    const low = await create({ title: "Low", parentTaskId: mid.id });

    const refused = { ok: false, error: { code: "task_parent_invalid" } };
    expect(await call("updateTask", { taskId: top.id, parentTaskId: low.id })).toMatchObject(refused);
    expect(await call("updateTask", { taskId: mid.id, parentTaskId: mid.id })).toMatchObject(refused);
    expect((await get(top.id)).parentTaskId).toBeNull();
  });
});
