import { mkdtempSync, rmSync } from "node:fs";
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
