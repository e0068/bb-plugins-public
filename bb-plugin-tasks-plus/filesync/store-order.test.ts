import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";
import { loadTaskOrders } from "./order-store.js";

let root: string;
let kv: KvStore;
let board: BoardConfig;

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key) as never;
    },
    async set(key, value) {
      map.set(key, structuredClone(value));
    },
  };
}

async function newStore() {
  const store = createFileTasksStore(kv, [board], [], [], [], () => {}, () => null, await loadTaskOrders(kv));
  store.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
  return store;
}

/** Creates tasks one second apart on disk, oldest first, and gives their ids. */
async function seed(store: Awaited<ReturnType<typeof newStore>>, titles: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, title] of titles.entries()) {
    const task = await store.createTask({ projectId: "b1", title });
    const at = new Date(Date.UTC(2026, 8, 1, 0, 0, index));
    utimesSync(task.source!.filePath, at, at);
    ids.push(task.id);
  }
  return ids;
}

const titlesOf = async (store: Awaited<ReturnType<typeof newStore>>) =>
  (await store.listTasks({ projectId: "b1" })).map((task) => task.title);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "store-order-"));
  kv = fakeKv();
  board = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("manual order of a board", () => {
  it("lists tasks nobody reordered newest first", async () => {
    const store = await newStore();
    await seed(store, ["A", "B", "C"]);

    expect(await titlesOf(store)).toEqual(["C", "B", "A"]);
  });

  it("lists a moved task between its new neighbours, positions counting from the top", async () => {
    const store = await newStore();
    const [a, b, c] = await seed(store, ["A", "B", "C"]);

    await store.placeTask(a!, { beforeTaskId: c!, afterTaskId: b! });
    const tasks = await store.listTasks({ projectId: "b1" });

    expect(tasks.map((task) => task.title)).toEqual(["C", "A", "B"]);
    expect(tasks.map((task) => task.position)).toEqual([0, 1, 2]);
  });

  it("keeps the order after the store restarts from the same KV", async () => {
    const first = await newStore();
    const [a, , c] = await seed(first, ["A", "B", "C"]);
    await first.placeTask(c!, { beforeTaskId: a!, afterTaskId: null });

    expect(await titlesOf(await newStore())).toEqual(["B", "A", "C"]);
  });

  it("keeps both moves of two drops that arrive together", async () => {
    const store = await newStore();
    const [a, b, c, d] = await seed(store, ["A", "B", "C", "D"]);

    await Promise.all([
      store.placeTask(d!, { beforeTaskId: a!, afterTaskId: null }),
      store.placeTask(b!, { beforeTaskId: c!, afterTaskId: null }),
    ]);

    expect(await titlesOf(store)).toEqual(["C", "B", "A", "D"]);
  });

  it("puts a task created after the reorder on top", async () => {
    const store = await newStore();
    const [a, b] = await seed(store, ["A", "B"]);
    await store.placeTask(b!, { beforeTaskId: a!, afterTaskId: null });

    await store.createTask({ projectId: "b1", title: "New" });

    expect(await titlesOf(store)).toEqual(["New", "A", "B"]);
  });
});

describe("board reads", () => {
  it("answers requests that arrive together from one read of the files", async () => {
    const store = await newStore();
    await seed(store, ["A", "B"]);

    const [first, second] = await Promise.all([
      store.listTasks({ projectId: "b1" }),
      store.listTasks({ projectId: "b1" }),
    ]);

    expect(second[0]).toBe(first[0]);
  });

  it("reads the files again for a request that comes after a write", async () => {
    const store = await newStore();
    const [a] = await seed(store, ["A"]);

    const pending = store.listTasks({ projectId: "b1" });
    await store.updateTask(a!, { title: "Renamed" });
    const after = await store.listTasks({ projectId: "b1" });
    await pending;

    expect(after.map((task) => task.title)).toEqual(["Renamed"]);
  });
});
