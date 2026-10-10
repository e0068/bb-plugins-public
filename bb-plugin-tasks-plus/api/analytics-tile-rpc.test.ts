import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  root = mkdtempSync(join(tmpdir(), "analytics-tile-rpc-"));
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

const tile = (patch: Record<string, unknown> = {}) => ({
  id: "t1",
  type: "columns",
  title: "By status",
  window: "page",
  x: "status",
  y: { metric: "count", field: null },
  breakdown: null,
  switch: "project",
  conditions: [],
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
  ...patch,
});

const EDGES = [Date.now() - 86_400_000, Date.now() + 86_400_000];

describe("analyticsTile RPC", () => {
  it("answers a tile over the board, wire-valid, with the board's projects", async () => {
    const { harness } = setup();
    const a = await tasks.createTask({ projectId: BOARD.id, title: "A" });
    await tasks.createTask({ projectId: BOARD.id, title: "B" });
    await harness.callRpc("boardMove", { taskId: a.id, status: "in_progress", authorName: "Me" });

    const answer = (await harness.callRpc("analyticsTile", { tile: tile(), edges: EDGES, projectIds: [], picked: null })) as {
      columns: { key: string }[];
      values: number[][];
      switchValues: { key: string; label: string; count: number }[];
      projects: { id: string; name: string }[];
    };
    expect(Object.fromEntries(answer.columns.map((column, index) => [column.key, answer.values[index]![0]]))).toEqual({ backlog: 1, in_progress: 1 });
    expect(answer.switchValues).toEqual([{ key: BOARD.id, label: "Board", count: 2 }]);
    expect(answer.projects).toEqual([{ id: BOARD.id, name: "Board" }]);
  });

  it("closes the moves into a closed tile over time", async () => {
    const { harness } = setup();
    const a = await tasks.createTask({ projectId: BOARD.id, title: "A" });
    await harness.callRpc("boardMove", { taskId: a.id, status: "done", authorName: "Me" });

    const answer = (await harness.callRpc("analyticsTile", {
      tile: tile({ x: "time", switch: null, y: { metric: "closed", field: null } }),
      edges: EDGES,
      projectIds: [],
      picked: null,
    })) as { values: number[][]; cells: string[][][] };
    expect(answer.values).toEqual([[1]]);
    expect(answer.cells[0]![0]).toEqual([a.key]);
  });
});

describe("analyticsTile RPC — the page's filters and the big numbers", () => {
  it("counts only the tasks the page's filters keep", async () => {
    const { harness } = setup();
    const a = await tasks.createTask({ projectId: BOARD.id, title: "A" });
    await tasks.createTask({ projectId: BOARD.id, title: "B" });
    await harness.callRpc("boardMove", { taskId: a.id, status: "in_progress", authorName: "Me" });
    const filters = { statuses: ["in_progress"], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] };

    const answer = (await harness.callRpc("analyticsTile", { tile: tile(), edges: EDGES, projectIds: [], filters, picked: null })) as { columns: { key: string }[]; total: number };
    expect(answer.columns.map((column) => column.key)).toEqual(["in_progress"]);
    expect(answer.total).toBe(1);
  });

  it("reads the tasks' attachments when the page filters by them, on a tile that never names them", async () => {
    const { harness } = setup();
    mkdirSync(join(root, "tasks", "todo"), { recursive: true });
    writeFileSync(join(root, "tasks", "todo", "shot.md"), "---\ntitle: Shot\nslug: shot\nattachments:\n  - id: a1\n    fileName: shot.png\n---\n\n## Comments\n");
    writeFileSync(join(root, "tasks", "todo", "bare.md"), "---\ntitle: Bare\nslug: bare\n---\n\n## Comments\n");
    const filters = { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [], numbers: { attachments: { from: 1, to: null, empty: false } } };

    const answer = (await harness.callRpc("analyticsTile", { tile: tile(), edges: EDGES, projectIds: [], filters, picked: null })) as { total: number };
    expect(answer.total).toBe(1);
  });

  it("tells what a big tile's sums are made of, wire-valid", async () => {
    const { harness } = setup();
    const a = await tasks.createTask({ projectId: BOARD.id, title: "A", budget: 10, cost: 4 });
    const b = await tasks.createTask({ projectId: BOARD.id, title: "B", budget: 20 });
    await harness.callRpc("boardMove", { taskId: a.id, status: "done", authorName: "Me" });
    await harness.callRpc("boardMove", { taskId: b.id, status: "done", authorName: "Me" });

    const answer = (await harness.callRpc("analyticsTile", {
      tile: tile({ type: "big", x: "time", switch: null, figures: ["budget", "cost"] }),
      edges: EDGES,
      projectIds: [],
      picked: null,
    })) as { figures: Record<string, number>; sums: unknown };
    expect(answer.figures).toMatchObject({ closed: 2, budget: 30, cost: 4 });
    expect(answer.sums).toEqual({ carriers: { planned: 0, actual: 0, budget: 2, cost: 1, limit: 0 }, paired: { cost: 4, budget: 10 } });
  });

  it("dates a task by the `created:` its file declares, not by when git last wrote the file", async () => {
    mkdirSync(join(root, "tasks", "done"), { recursive: true });
    writeFileSync(join(root, "tasks", "done", "old.md"), "---\ntitle: Old\nslug: old\ncreated: 2025-12-01T09:00:00.000Z\n---\n\n## Comments\n");
    const [task] = await tasks.listTasks({});
    expect(task?.createdAt).toBe("2025-12-01T09:00:00.000Z");
  });
});

describe("analytics dashboard RPC", () => {
  it("reads nothing before a save, and reads back what was saved", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("loadAnalyticsDashboard", {})).toBeNull();
    const dashboard = { version: 1, tiles: [tile()], rows: [{ id: "r1", height: 240, minHeight: 180, cells: [{ id: "t1", weight: 1 }] }] };
    await harness.callRpc("saveAnalyticsDashboard", dashboard);
    expect(await harness.callRpc("loadAnalyticsDashboard", {})).toEqual(dashboard);
  });

  it("drops a cell whose tile is gone, and the row it empties", async () => {
    const { harness } = setup();
    const dashboard = {
      version: 1,
      tiles: [tile()],
      rows: [
        { id: "r1", height: 240, minHeight: 180, cells: [{ id: "t1", weight: 1 }] },
        { id: "r2", height: 240, minHeight: 180, cells: [{ id: "ghost", weight: 1 }] },
      ],
    };
    await harness.callRpc("saveAnalyticsDashboard", dashboard);
    expect(await harness.callRpc("loadAnalyticsDashboard", {})).toEqual({ ...dashboard, rows: [dashboard.rows[0]] });
  });
});

describe("analyticsTileTasks RPC", () => {
  it("lists the tasks of a picked segment in the asked order, wire-valid, with how many there are", async () => {
    const { harness } = setup();
    const a = await tasks.createTask({ projectId: BOARD.id, title: "A" });
    const b = await tasks.createTask({ projectId: BOARD.id, title: "B" });
    const c = await tasks.createTask({ projectId: BOARD.id, title: "C" });
    await harness.callRpc("boardMove", { taskId: c.id, status: "in_progress", authorName: "Me" });
    const ask = { tile: tile({ switch: null }), edges: EDGES, projectIds: [], picked: null, sort: { column: "title", direction: "desc" } };

    const all = (await harness.callRpc("analyticsTileTasks", { ...ask, pick: null, limit: 2 })) as { tasks: { key: string }[]; total: number };
    expect(all.total).toBe(3);
    expect(all.tasks.map((task) => task.key)).toEqual([c.key, b.key]);

    const backlog = (await harness.callRpc("analyticsTileTasks", { ...ask, pick: { column: 0, series: null }, limit: 10 })) as { tasks: { key: string }[]; total: number };
    expect(backlog).toMatchObject({ total: 2 });
    expect(backlog.tasks.map((task) => task.key)).toEqual([b.key, a.key]);
  });
});
