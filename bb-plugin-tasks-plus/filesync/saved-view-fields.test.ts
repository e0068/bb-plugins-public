import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { savedViewSchema } from "../shared/contract.js";
import { createFileTasksStore, loadFileTasksStore } from "./store.js";
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
  root = mkdtempSync(join(tmpdir(), "saved-view-fields-"));
  const board: BoardConfig = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };
  store = createFileTasksStore(fakeKv(), [board], [], [], [], () => {});
  store.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const SEVEN = { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] };

const input = {
  name: "Every field",
  projectId: null,
  listScope: null,
  filters: {
    ...SEVEN,
    values: { epic: ["b1:epic"], flow: ["Code"] },
    texts: { title: "login" },
    dates: { dueDate: { from: "2026-10-01", to: null, empty: true } },
    numbers: { cost: { from: null, to: 5, empty: false } },
  },
  sort: { column: "flow", direction: "desc" },
  fields: { fields: [], showEmpty: false, showDescription: false },
};

describe("a view filtered and sorted by any field", () => {
  it("reads back with the filters and the sort it was saved with", () => {
    store.createSavedView(input as never);
    const [listed] = store.listSavedViews();
    expect(listed!.filters).toEqual(input.filters);
    expect(listed!.sort).toEqual(input.sort);
  });

  it("a view saved before keeps its seven filters and its list sort as they were", () => {
    const before = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZV1",
      version: 2,
      name: "Old",
      projectId: null,
      listScope: null,
      filters: SEVEN,
      sort: "due",
      fields: { fields: [], showEmpty: false, showDescription: false },
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    const parsed = savedViewSchema.parse(before);
    expect(parsed.filters).toEqual(SEVEN);
    expect(parsed.sort).toBe("due");
  });

  it("the contract refuses a sort by a field that is not one, and a malformed range", () => {
    const view = { ...input, id: "01HZZZZZZZZZZZZZZZZZZZZZV2", version: 2, createdAt: "2026-07-01T00:00:00.000Z" };
    expect(savedViewSchema.safeParse(view).success).toBe(true);
    expect(savedViewSchema.safeParse({ ...view, sort: { column: "nope", direction: "asc" } }).success).toBe(false);
    expect(
      savedViewSchema.safeParse({ ...view, filters: { ...input.filters, dates: { dueDate: { from: "tomorrow", to: null, empty: false } } } }).success,
    ).toBe(false);
    expect(savedViewSchema.safeParse({ ...view, filters: { ...input.filters, values: { nope: ["x"] } } }).success).toBe(false);
  });
});

describe("a view filtered and sorted by any field, after a reload", () => {
  it("comes back from storage with the filters and the sort it was saved with", async () => {
    const kv = fakeKv();
    const board: BoardConfig = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };
    await kv.set("boards", [board]);
    const first = createFileTasksStore(kv, [board], [], [], [], () => {});
    first.createSavedView(input as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reloaded = await loadFileTasksStore(kv, () => {}, () => null);
    const [view] = reloaded.listSavedViews();
    expect(view!.filters).toEqual(input.filters);
    expect(view!.sort).toEqual(input.sort);
  });
});
