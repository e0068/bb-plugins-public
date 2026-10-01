import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerTasksCli } from "../cli/index.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";

// `bb tasks epics migrate`: every epic folder becomes an epic task, its tasks
// move up to the assignee's folder and go under it.

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
let host: ReturnType<typeof createFakePluginHost>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "epic-migrate-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
  const store: TasksApiStore = {
    tasks,
    transitions: { record() {}, range: () => [], firstAtMs: () => null },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) => (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: () => false,
    openTaskCount: async () => 0,
    sidebarSummary: async () => [],
  };
  host = createFakePluginHost({ pluginId: "tasks" });
  registerTasksApi(host.bb, store, { get: async () => null });
  registerTasksCli(host.bb, store, { name: "Tasks+", version: "test" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const migrate = (dryRun: boolean) =>
  host.harness.behavior.callRpc("migrateEpics", { projectId: BOARD.id, dryRun }) as Promise<{
    epics: { key: string | null; name: string; assignee: string; tasks: number }[];
  }>;

async function seedFolders() {
  const a = await tasks.createTask({ projectId: BOARD.id, title: "Alpha", assignee: "Claude", epic: "Flow", status: "done" });
  const b = await tasks.createTask({ projectId: BOARD.id, title: "Beta", assignee: "Claude", epic: "Flow", status: "in_progress" });
  const sub = await tasks.createTask({ projectId: BOARD.id, title: "Sub", assignee: "Claude", epic: "Flow", parentTaskId: b.id });
  return { a, b, sub };
}

describe("migrateEpics", () => {
  it("turns an epic folder into an epic task at the assignee's level, the folder's tasks under it", async () => {
    const { a, b, sub } = await seedFolders();

    const result = await migrate(false);

    expect(result.epics).toEqual([{ key: "TSK-4", name: "Flow", assignee: "Claude", tasks: 3 }]);
    expect(existsSync(join(root, "Claude", "Flow"))).toBe(false);
    const epic = (await tasks.listTasks({ projectId: BOARD.id })).find((task) => task.type === "epic")!;
    expect(epic).toMatchObject({ title: "Flow", assignee: "Claude", status: "in_progress", epic: null });
    for (const id of [a.id, b.id]) expect((await tasks.getTask(id))!).toMatchObject({ parentTaskId: epic.id, epic: null, epicId: epic.id });
    expect((await tasks.getTask(sub.id))!).toMatchObject({ parentTaskId: b.id, epicId: epic.id });
    expect(readdirSync(join(root, "Claude")).sort()).toEqual(["backlog", "done", "in_progress"]);
  });

  it("a second run finds nothing to do", async () => {
    await seedFolders();
    await migrate(false);
    expect(await migrate(false)).toEqual({ epics: [] });
  });

  it("a dry run tells the plan and touches nothing", async () => {
    await seedFolders();
    expect(await migrate(true)).toEqual({ epics: [{ key: null, name: "Flow", assignee: "Claude", tasks: 3 }] });
    expect(readdirSync(join(root, "Claude", "Flow")).length).toBeGreaterThan(0);
  });

  it("is `bb tasks epics migrate` on the command line", async () => {
    await seedFolders();
    const dry = await host.harness.runCli(["epics", "migrate", "--project", "TSK", "--dry-run"]);
    expect(dry).toMatchObject({ exitCode: 0, stdout: "would create Flow (Claude) ← 3 tasks\n" });
    const run = await host.harness.runCli(["epics", "migrate", "--project", "TSK"]);
    expect(run).toMatchObject({ exitCode: 0, stdout: "TSK-4 Flow (Claude) ← 3 tasks\n" });
  });
});
