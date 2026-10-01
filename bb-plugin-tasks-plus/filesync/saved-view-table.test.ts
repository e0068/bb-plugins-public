import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

let root: string;
let store: ReturnType<typeof createFileTasksStore>;

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "saved-view-table-"));
  const board: BoardConfig = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };
  store = createFileTasksStore(fakeKv(), [board], [], [], [], () => {});
  store.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const input = {
  name: "Mine",
  projectId: null,
  listScope: null,
  filters: { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] },
  sort: "manual" as const,
  fields: { fields: [], showEmpty: false, showDescription: false },
};

const table = {
  sort: { column: "priority", direction: "asc" },
  groupBy: "none",
  widths: { title: 400 },
  pinned: ["title", "priority"],
  collapsedGroups: [],
};

describe("saved views are stored as tables by default", () => {
  it("a view created without a surface is stored as a table with its settings", () => {
    const bare = store.createSavedView(input as never);
    expect(bare.surface).toBe("table");
    expect((bare as { table?: unknown }).table ?? null).toBeNull();

    const withTable = store.createSavedView({ ...input, name: "Mine too", table } as never);
    expect(withTable.surface).toBe("table");
    const [, listed] = store.listSavedViews();
    expect((listed as { table?: unknown }).table).toEqual(table);
  });
});
