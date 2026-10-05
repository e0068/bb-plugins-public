// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import { DatabaseAuthFailed, DatabaseUnreachable } from "../filesync/task-repo.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, sidebarSummary, type TasksApiStore } from "./index.js";

const board = (id: string, prefix: string): BoardConfig => ({
  id,
  name: prefix,
  prefix,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
  database: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const FILES = board("01M0T4QGCQ3BYK15NH50AD38RV", "FIL");
const REMOTE = board("01M0T4QGCQ3BYK15NH50AD38RW", "REM");
/** A database board with no repository opened for it: every read of it is `DatabaseUnreachable`, the real way. */
const DARK: BoardConfig = { ...board("01M0T4QGCQ3BYK15NH50AD38RX", "DRK"), database: { url: "libsql://dark.example" } };

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key) as never, set: async (key, value) => void map.set(key, structuredClone(value)) };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "list-projects-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Two boards, the second kept in a database that answers every read with `failure`. */
function host(failure: Error) {
  const files = createFileTasksStore(fakeKv(), [FILES, REMOTE], [], [], [], () => {});
  files.setBoardRoots(FILES.id, [{ absPath: root, origin: { kind: "main" } }]);
  const tasks = {
    ...files,
    listTasks: (filters: Parameters<typeof files.listTasks>[0] = {}) =>
      filters.projectId === REMOTE.id ? Promise.reject(failure) : files.listTasks(filters),
    threadsByTaskId: (projectId: string) =>
      projectId === REMOTE.id ? Promise.reject(failure) : files.threadsByTaskId(projectId),
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = {
    tasks,
    transitions: createTransitionLog(bb.storage.database()),
    transaction: (operation: () => unknown) => files.transaction(operation),
  } as unknown as TasksApiStore;
  registerTasksApi(bb, store, { get: async () => null });
  return { files, tasks, harness };
}

describe("listProjects with a board whose database is out of reach", () => {
  it.each([
    ["refuses its token", new DatabaseAuthFailed()],
    ["does not answer", new DatabaseUnreachable()],
  ])("still lists every board when that database %s", async (_, failure) => {
    const { files, harness } = host(failure);
    await files.createTask({ projectId: FILES.id, title: "First" });

    const { projects } = (await harness.callRpc("listProjects", {})) as { projects: { id: string; nextTaskNumber: number }[] };

    expect(projects.map((project) => project.id).sort()).toEqual([FILES.id, REMOTE.id].sort());
    expect(projects.find((project) => project.id === FILES.id)?.nextTaskNumber).toBe(2);
  });
});

describe("sidebarSummary with a board whose database is out of reach", () => {
  it.each([
    ["refuses its token", new DatabaseAuthFailed()],
    ["does not answer", new DatabaseUnreachable()],
  ])("counts that board as empty and the others as they are when that database %s", async (_, failure) => {
    const { files, tasks } = host(failure);
    await files.createTask({ projectId: FILES.id, title: "First" });

    const summary = await sidebarSummary(tasks as unknown as typeof files);

    expect(summary).toEqual([
      { projectId: FILES.id, taskCount: 1, activeAgentCount: 0 },
      { projectId: REMOTE.id, taskCount: 0, activeAgentCount: 0 },
    ]);
  });
});

/** The dark board first: a lookup that walks boards in order meets it before the healthy one. */
function darkHost() {
  const tasks = createFileTasksStore(fakeKv(), [DARK, FILES], [], [], [], () => {});
  tasks.setBoardRoots(FILES.id, [{ absPath: root, origin: { kind: "main" } }]);
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = {
    tasks,
    transitions: createTransitionLog(bb.storage.database()),
    transaction: (operation: () => unknown) => tasks.transaction(operation),
  } as unknown as TasksApiStore;
  registerTasksApi(bb, store, { get: async () => null });
  return { tasks, harness };
}

describe("lookups across boards with a dark board ahead of a healthy one", () => {
  it("finds, edits and lists what lives on the healthy board", async () => {
    const { tasks } = darkHost();
    const task = await tasks.createTask({ projectId: FILES.id, title: "First" });
    await tasks.addTaskLabel(task.id, "ui");
    const comment = await tasks.createComment({ taskId: task.id, kind: "agent", authorName: "Me", body: "Hello" });

    expect((await tasks.getComment(comment.id))?.body).toBe("Hello");
    expect((await tasks.updateComment(comment.id, { body: "Edited" })).body).toBe("Edited");
    expect(await tasks.listAttachmentsForComment(comment.id)).toEqual([]);
    expect((await tasks.getLabel("ui"))?.projectId).toBe(FILES.id);
  });

  it("answers an item found on no board with the dark board's failure: it may live there", async () => {
    const { tasks } = darkHost();

    await expect(tasks.updateComment("01M0T4QGCQ3BYK15NH50AD38RZ", { body: "x" })).rejects.toBeInstanceOf(DatabaseUnreachable);
  });

  it("draws an analytics tile over the healthy board", async () => {
    const { tasks, harness } = darkHost();
    await tasks.createTask({ projectId: FILES.id, title: "First" });

    const answer = (await harness.callRpc("analyticsTile", {
      tile: {
        id: "t1", type: "columns", title: "By status", window: "page", x: "status",
        y: { metric: "count", field: null }, breakdown: null, switch: "project", conditions: [], sort: null, limit: 20,
        bars: { length: "value", gantt: "fact" }, figures: [],
        display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
      },
      edges: [Date.now() - 86_400_000, Date.now() + 86_400_000],
      projectIds: [],
      picked: null,
    })) as { values: number[][] };

    expect(answer.values.flat().reduce((sum, value) => sum + value, 0)).toBe(1);
  });
});
