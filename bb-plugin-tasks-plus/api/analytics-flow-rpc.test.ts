import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import type { GanttAnswer } from "../shared/contract.js";
import { registerTasksApi, type TasksApiStore } from ".";

// Over the RPC boundary: callRpc validates the output against the contract
// schema, so a passing call also proves the flow shape is wire-valid.
const board = (id: string, name: string, prefix: string): BoardConfig => ({
  id,
  name,
  prefix,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
  database: null, createdAt: "2026-01-01T00:00:00.000Z",
});
const PLUGINS = board("01M0T4QGCQ3BYK15NH50AD38RV", "Plugins", "TSK");
const QUARRY = board("01M0T4QGCQ3BYK15NH50AD38RW", "Quarry", "QRY");

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

let roots: string[];
let tasks: ReturnType<typeof createFileTasksStore>;

beforeEach(() => {
  roots = [PLUGINS, QUARRY].map(() => mkdtempSync(join(tmpdir(), "analytics-flow-rpc-")));
  tasks = createFileTasksStore(fakeKv(), [PLUGINS, QUARRY], [], [], [], () => {});
  tasks.setBoardRoots(PLUGINS.id, [{ absPath: roots[0]!, origin: { kind: "main" } }]);
  tasks.setBoardRoots(QUARRY.id, [{ absPath: roots[1]!, origin: { kind: "main" } }]);
});

afterEach(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

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

/** Two boards: Plugins with a task taken to review, Quarry with a task closed. */
async function seed(harness: ReturnType<typeof setup>["harness"]) {
  const from = Date.now() - 1000;
  const review = await tasks.createTask({ projectId: PLUGINS.id, title: "Review me" });
  const shipped = await tasks.createTask({ projectId: QUARRY.id, title: "Shipped", estimate: "s", cost: 2.5 });
  await harness.callRpc("boardMove", { taskId: review.id, status: "in_review", authorName: "Me" });
  await harness.callRpc("boardMove", { taskId: shipped.id, status: "in_progress", authorName: "Me" });
  await harness.callRpc("boardMove", { taskId: shipped.id, status: "done", authorName: "Me" });
  const to = Date.now() + 1000;
  return { review, shipped, edges: [from, to], weekEdges: [from, to] };
}

describe("ganttRows RPC", () => {
  it("gives each task the stretches it worked in, when it was done and its planned dates, over the wire", async () => {
    const { harness } = setup();
    const { review, shipped, edges } = await seed(harness);
    const planned = await tasks.createTask({ projectId: PLUGINS.id, title: "Planned", startDate: "2026-10-01", dueDate: "2026-10-09" });

    const answer = (await harness.callRpc("ganttRows", { fromMs: edges[0] })) as GanttAnswer;

    const byId = new Map(answer.rows.map((row) => [row.taskId, row]));
    expect(byId.get(review.id)?.segments.map((segment) => segment.status)).toEqual(["in_review"]);
    expect(byId.get(review.id)).toMatchObject({ key: review.key, doneMs: null });
    // Closed within the window: the stretch it worked, and the moment it was done.
    expect(byId.get(shipped.id)?.segments.map((segment) => segment.status)).toEqual(["in_progress"]);
    expect(byId.get(shipped.id)?.doneMs).toBe(byId.get(shipped.id)?.segments.at(-1)?.toMs);
    expect(byId.get(planned.id)).toMatchObject({ startDate: "2026-10-01", dueDate: "2026-10-09", parentTaskId: null, segments: [] });
    expect(answer.projects.map((project) => project.id).sort()).toEqual([PLUGINS.id, QUARRY.id].sort());
  });

  it("keeps to the projects asked for", async () => {
    const { harness } = setup();
    const { review, edges } = await seed(harness);
    const answer = (await harness.callRpc("ganttRows", { fromMs: edges[0], projectIds: [PLUGINS.id] })) as GanttAnswer;
    expect(answer.rows.map((row) => row.taskId)).toEqual([review.id]);
  });
});

describe("analyticsSpan RPC", () => {
  it("names when the first task of the asked projects was made, and nothing for an empty board", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("analyticsSpan", {})).toEqual({ firstCreatedMs: null });
    const before = Date.now();
    await tasks.createTask({ projectId: QUARRY.id, title: "First" });
    const between = Date.now() + 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await tasks.createTask({ projectId: PLUGINS.id, title: "Second" });
    const all = (await harness.callRpc("analyticsSpan", {})) as { firstCreatedMs: number };
    expect(all.firstCreatedMs).toBeGreaterThanOrEqual(before - 1);
    expect(all.firstCreatedMs).toBeLessThanOrEqual(between);
    const plugins = (await harness.callRpc("analyticsSpan", { projectIds: [PLUGINS.id] })) as { firstCreatedMs: number };
    expect(plugins.firstCreatedMs).toBeGreaterThan(between);
  });
});
