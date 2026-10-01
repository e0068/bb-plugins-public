import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TasksApiStore } from "../api/index.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { createFileTasksStore } from "../filesync/store.js";
import { registerTasksCli } from "./index.js";

// --epic names an epic task: it becomes the task's parent, no folder moves.

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
  root = mkdtempSync(join(tmpdir(), "cli-epic-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function cli() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store: TasksApiStore = {
    tasks,
    transitions: { record() {}, range: () => [], firstAtMs: () => null },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) => (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: () => false,
    openTaskCount: async () => (await tasks.listTasks({})).length,
    sidebarSummary: async () => [],
  };
  registerTasksCli(bb, store, { name: "Tasks+", version: "test" });
  return (args: string[]) => harness.runCli(args);
}

const ok = (result: { exitCode: number; stdout: string; stderr: string }) => {
  expect(result, result.stderr).toMatchObject({ exitCode: 0, stderr: "" });
  return result.stdout;
};

describe("bb tasks --epic", () => {
  it("create --type epic makes an epic; create --epic puts the new task under it", async () => {
    const run = cli();
    const epic = JSON.parse(ok(await run(["create", "--project", "TSK", "--title", "Flow", "--type", "epic", "--json"]))).task;
    const child = JSON.parse(ok(await run(["create", "--project", "TSK", "--title", "Child", "--epic", epic.key, "--json"]))).task;

    expect(epic.type).toBe("epic");
    expect(child).toMatchObject({ parentTaskId: epic.id, epicId: epic.id, assignee: null });
    expect(ok(await run(["show", child.key]))).toMatch(/Epic\s+TSK-1 Flow/);
  });

  it("update --epic sets the parent, --no-epic takes an epic parent off", async () => {
    const run = cli();
    const epic = await tasks.createTask({ projectId: BOARD.id, title: "Flow", type: "epic" });
    const task = await tasks.createTask({ projectId: BOARD.id, title: "Task" });

    ok(await run(["update", task.key, "--epic", epic.key]));
    expect((await tasks.getTask(task.id))!.parentTaskId).toBe(epic.id);

    ok(await run(["update", task.key, "--no-epic"]));
    expect((await tasks.getTask(task.id))!.parentTaskId).toBeNull();
  });

  it("refuses --epic on a task that is not an epic, and --epic with --parent", async () => {
    const run = cli();
    const plain = await tasks.createTask({ projectId: BOARD.id, title: "Plain" });
    const task = await tasks.createTask({ projectId: BOARD.id, title: "Task" });

    await expect(run(["update", task.key, "--epic", plain.key])).resolves.toMatchObject({
      exitCode: 1,
      stderr: `${plain.key} is not an epic`,
    });
    await expect(run(["update", task.key, "--epic", plain.key, "--parent", plain.key])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--epic and --parent cannot be combined",
    });
  });

  it("--no-epic refuses when the parent is not an epic", async () => {
    const run = cli();
    const parent = await tasks.createTask({ projectId: BOARD.id, title: "Parent" });
    const task = await tasks.createTask({ projectId: BOARD.id, title: "Task", parentTaskId: parent.id });

    await expect(run(["update", task.key, "--no-epic"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: `the parent of ${task.key} is not an epic`,
    });
  });

  it("refuses a parent named and cleared at once, whichever flags spell it", async () => {
    const run = cli();
    const epic = await tasks.createTask({ projectId: BOARD.id, title: "Flow", type: "epic" });
    const task = await tasks.createTask({ projectId: BOARD.id, title: "Task" });
    await expect(run(["update", task.key, "--epic", epic.key, "--no-parent"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--epic and --no-parent cannot be combined",
    });
    await expect(run(["update", task.key, "--parent", epic.key, "--no-epic"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--parent and --no-epic cannot be combined",
    });
  });

  it("fails on an unknown epics subcommand instead of printing help", async () => {
    const run = cli();
    await expect(run(["epics", "migrat"])).resolves.toMatchObject({ exitCode: 1, stderr: "unknown epics subcommand: migrat" });
    await expect(run(["epics"])).resolves.toMatchObject({ exitCode: 0 });
  });
});
