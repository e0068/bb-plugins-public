import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";
import { WINDOW_COUNT_MAX, WINDOW_UNITS } from "../shared/analytics-tile.js";

// The longest period a tile may count must pass the call that fetches its data.
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
  root = mkdtempSync(join(tmpdir(), "analytics-tile-longest-"));
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
  registerTasksApi(bb, store, { get: async () => null });
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

describe("analyticsTile over the longest periods", () => {
  it("answers a tile of every unit at its cap", async () => {
    const { harness } = setup();
    await tasks.createTask({ projectId: BOARD.id, title: "A" });
    for (const unit of WINDOW_UNITS) {
      const step = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }[unit];
      const edges = Array.from({ length: WINDOW_COUNT_MAX[unit] + 1 }, (_, index) => Date.now() - (WINDOW_COUNT_MAX[unit] - index) * step);
      const answer = (await harness.callRpc("analyticsTile", { tile: tile({ x: "time", window: { unit, count: WINDOW_COUNT_MAX[unit] } }), edges, projectIds: [], picked: null })) as { columns: unknown[] };
      expect(answer.columns).toHaveLength(WINDOW_COUNT_MAX[unit]);
    }
  });
});
