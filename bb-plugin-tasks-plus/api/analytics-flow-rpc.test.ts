import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import type { ClosedWindows, FlowAnswer, GanttAnswer, TasksSnapshot } from "../shared/contract.js";
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

describe("analyticsFlow RPC", () => {
  it("answers every flow chart for all boards in one wire-valid call", async () => {
    const { harness } = setup();
    const { review, shipped, edges, weekEdges } = await seed(harness);

    const flow = (await harness.callRpc("analyticsFlow", { edges, weekEdges, projectIds: [] })) as FlowAnswer;

    expect(flow.statusByBin[PLUGINS.id]).toEqual([expect.objectContaining({ in_review: 1 })]);
    expect(flow.statusByBin[QUARRY.id]).toEqual([expect.objectContaining({ done: 1 })]);
    expect(flow.created).toEqual([2]);
    expect(flow.closed).toEqual([1]);
    expect(flow.cycle).toEqual([expect.objectContaining({ estimate: "s", count: 1 })]);
    expect(flow.costByProject).toEqual([{ projectId: QUARRY.id, cost: 2.5 }]);
    expect(flow.aging).toEqual([expect.objectContaining({ taskId: review.id, key: review.key, title: "Review me", status: "in_review" })]);
    expect(flow.projects.map((project) => project.name)).toEqual(["Plugins", "Quarry"]);
    expect(shipped.key).not.toBe(review.key);
  });

  it("narrows every chart to the projects asked for", async () => {
    const { harness } = setup();
    const { edges, weekEdges } = await seed(harness);

    const flow = (await harness.callRpc("analyticsFlow", { edges, weekEdges, projectIds: [PLUGINS.id] })) as FlowAnswer;

    expect(Object.keys(flow.statusByBin)).toEqual([PLUGINS.id]);
    expect(flow.created).toEqual([1]);
    expect(flow.closed).toEqual([0]);
    expect(flow.costByProject).toEqual([]);
  });
});

describe("projectIds on the other analytics calls", () => {
  it("narrows the snapshot to the projects asked for", async () => {
    const { harness } = setup();
    await seed(harness);
    const snap = (await harness.callRpc("analyticsSnapshot", { projectIds: [QUARRY.id] })) as TasksSnapshot;
    expect(snap.total).toBe(1);
    expect(snap.byStatus.done).toBe(1);
  });

  it("narrows the closings to the projects asked for", async () => {
    const { harness } = setup();
    const { edges } = await seed(harness);
    const narrowed = (await harness.callRpc("analyticsClosed", { windows: [edges], projectIds: [PLUGINS.id] })) as ClosedWindows;
    expect(narrowed.windows[0]!.closings).toEqual([]);
  });
});

describe("analyticsFlow RPC — the narrowing reaches the per-task charts too", () => {
  it("keeps other projects' stuck tasks, closings by type and moves out", async () => {
    const { harness } = setup();
    const { edges, weekEdges } = await seed(harness);
    const flow = (await harness.callRpc("analyticsFlow", { edges, weekEdges, projectIds: [QUARRY.id] })) as FlowAnswer;
    expect(flow.aging).toEqual([]);
    expect(flow.typesByWeek.map((week) => Object.values(week).reduce((a, b) => a + b, 0))).toEqual([1]);
    expect(flow.changes.map((counts) => Object.values(counts).reduce((a, b) => a + b, 0))).toEqual([2]);
    expect(flow.cycle).toEqual([expect.objectContaining({ estimate: "s", count: 1 })]);
  });
});

describe("ganttRows RPC", () => {
  it("gives each task its stretches by status since the start, with its planned dates, over the wire", async () => {
    const { harness } = setup();
    const { review, shipped, edges } = await seed(harness);
    const planned = await tasks.createTask({ projectId: PLUGINS.id, title: "Planned", startDate: "2026-10-01", dueDate: "2026-10-09" });

    const answer = (await harness.callRpc("ganttRows", { fromMs: edges[0] })) as GanttAnswer;

    const byId = new Map(answer.rows.map((row) => [row.taskId, row]));
    expect(byId.get(review.id)?.segments.map((segment) => segment.status)).toEqual(["backlog", "in_review"]);
    expect(byId.get(review.id)?.key).toBe(review.key);
    // Closed within the window: only the stretches it stood open.
    expect(byId.get(shipped.id)?.segments.map((segment) => segment.status)).toEqual(["backlog", "in_progress"]);
    expect(byId.get(planned.id)).toMatchObject({ startDate: "2026-10-01", dueDate: "2026-10-09", parentTaskId: null });
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
