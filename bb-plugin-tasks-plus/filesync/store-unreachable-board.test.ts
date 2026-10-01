// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { createDbRepo } from "./db-repo.js";
import { DatabaseUnreachable } from "./task-repo.js";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

const board = (id: string, prefix: string, database: BoardConfig["database"]): BoardConfig => ({
  id,
  name: prefix,
  prefix,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
  database,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const FOLDER = board("01M0T4QGCQ3BYK15NH50AD38RV", "FLD", null);
const LIVE = board("01M0T4QGCQ3BYK15NH50AD38RW", "LIV", { url: "libsql://live.turso.io" });
/** A database board whose repository was never set — no token saved, or not connected yet. */
const DARK = board("01M0T4QGCQ3BYK15NH50AD38RX", "DRK", { url: "libsql://dark.turso.io" });

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key) as never,
    set: async (key, value) => void map.set(key, structuredClone(value)),
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function threeBoards() {
  const fake = createHranaFake();
  fake.addDatabase("live.turso.io", "t1");
  const repo = createDbRepo(createHranaClient({ url: "libsql://live.turso.io", token: "t1", fetch: fake.fetch }), { url: "libsql://live.turso.io" });
  cleanups.push(() => repo.stop());
  await repo.writeBoard({ name: "LIV", prefix: "LIV" });
  await repo.sync();
  const dir = mkdtempSync(join(tmpdir(), "store-unreachable-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = createFileTasksStore(fakeKv(), [FOLDER, LIVE, DARK], [], [], [], () => {});
  store.setBoardRoots(FOLDER.id, [{ absPath: dir, origin: { kind: "main" } }]);
  store.setBoardRepo(LIVE.id, repo);
  return store;
}

describe("a database board that cannot be read", () => {
  it("does not stop lookups across boards from finding tasks on the others", async () => {
    const store = await threeBoards();
    await store.createTask({ projectId: FOLDER.id, title: "On the folder" });
    await store.createTask({ projectId: LIVE.id, title: "On the live database" });
    expect((await store.getTaskByKey("FLD-1"))?.title).toBe("On the folder");
    expect((await store.getTaskByKey("LIV-1"))?.title).toBe("On the live database");
    expect(await store.listTasksForThread("thr_none")).toEqual([]);
  });

  it("does not stop an edit on another database board", async () => {
    const store = await threeBoards();
    const task = await store.createTask({ projectId: LIVE.id, title: "Glow" });
    const edited = await store.updateTask(task.id, { title: "Shine" });
    expect(edited.title).toBe("Shine");
  });

  it("does not make every lookup wait out the timeout of a database that hangs", async () => {
    /** A server that never answers: the request ends only when the client gives up. */
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const hung = createDbRepo(createHranaClient({ url: "libsql://dark.turso.io", token: "t", fetch: hanging, timeoutMs: 300 }), { url: "libsql://dark.turso.io" });
    cleanups.push(() => hung.stop());
    const store = await threeBoards();
    store.setBoardRepo(DARK.id, hung);
    await store.createTask({ projectId: FOLDER.id, title: "On the folder" });
    await store.getTaskByKey("FLD-1");
    const started = performance.now();
    for (let call = 0; call < 3; call += 1) expect((await store.getTaskByKey("FLD-1"))?.title).toBe("On the folder");
    expect(performance.now() - started).toBeLessThan(300);
  });

  it("still reports the failure when that board is read on its own", async () => {
    const store = await threeBoards();
    await expect(store.listTasks({ projectId: DARK.id })).rejects.toBeInstanceOf(DatabaseUnreachable);
  });
});
