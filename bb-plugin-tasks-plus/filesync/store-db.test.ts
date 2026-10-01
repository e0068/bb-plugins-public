// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";
import type { CallerEnvironment } from "./caller-root.js";

const dbRepoPath = "./db-repo.js";
const repoPath = "./task-repo.js";
const hranaPath = "../remote/hrana.js";
const { createDbRepo } = await planned<typeof import("./db-repo.js")>(() => import(/* @vite-ignore */ dbRepoPath));
const { DatabaseUnreachable } = await planned<typeof import("./task-repo.js")>(() => import(/* @vite-ignore */ repoPath));
const { createHranaClient } = await planned<typeof import("../remote/hrana.js")>(() => import(/* @vite-ignore */ hranaPath));

type Store = ReturnType<typeof createFileTasksStore>;
type DbRepo = import("./db-repo.js").DbRepo;

const HOST = "board-me.turso.io";
const URL_ = `libsql://${HOST}`;

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
    get: async (key) => map.get(key) as never,
    set: async (key, value) => void map.set(key, structuredClone(value)),
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The store's own setBoardRepo, asked for by name so a missing one fails on an assertion. */
function setBoardRepo(store: Store, boardId: string, repo: DbRepo): void {
  const set = (store as unknown as { setBoardRepo?: (id: string, repo: DbRepo) => void }).setBoardRepo;
  expect(typeof set, "store.setBoardRepo is promised by the plan").toBe("function");
  set!(boardId, repo);
}

async function openRepo(fake: HranaFake): Promise<DbRepo> {
  const repo = createDbRepo(createHranaClient({ url: URL_, token: "t1", fetch: fake.fetch }), { url: URL_ });
  cleanups.push(() => repo.stop());
  await repo.sync();
  return repo;
}

/** One machine's store on a database board, and its repository. */
async function databaseMachine(fake: HranaFake, readCaller: () => CallerEnvironment | null = () => null) {
  const board: BoardConfig = { ...BOARD, database: { url: URL_ } };
  const store = createFileTasksStore(fakeKv(), [board], [], [], [], () => {}, readCaller);
  const repo = await openRepo(fake);
  setBoardRepo(store, board.id, repo);
  return { store, repo };
}

function newDatabase(): HranaFake {
  const fake = createHranaFake();
  fake.addDatabase(HOST, "t1");
  return fake;
}

async function folderStore(): Promise<Store> {
  const store = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  store.setBoardRoots(BOARD.id, [{ absPath: tempDir("store-db-folder-"), origin: { kind: "main" } }]);
  return store;
}

async function databaseStore(): Promise<Store> {
  const fake = newDatabase();
  const first = await openRepo(fake);
  await first.writeBoard({ name: BOARD.name, prefix: BOARD.prefix });
  return (await databaseMachine(fake)).store;
}

/** The same scenarios on both kinds of board: the store behaves alike whatever holds the files. */
describe.each([
  ["a folder board", folderStore],
  ["a database board", databaseStore],
])("the store on %s", (_, open) => {
  it("creates tasks under the next keys and finds them by key", async () => {
    const store = await open();
    const first = await store.createTask({ projectId: BOARD.id, title: "Glow" });
    const second = await store.createTask({ projectId: BOARD.id, title: "Shine" });
    expect([first.key, second.key]).toEqual(["TSK-1", "TSK-2"]);
    expect((await store.getTaskByKey("TSK-2"))?.title).toBe("Shine");
  });

  it("edits fields and moves the status", async () => {
    const store = await open();
    const created = await store.createTask({ projectId: BOARD.id, title: "Glow" });
    await store.updateTask(created.id, { title: "Glow brighter", status: "in_progress", priority: "high" });
    expect(await store.getTask(created.id)).toMatchObject({ title: "Glow brighter", status: "in_progress", priority: "high" });
    expect((await store.listTasks({ projectId: BOARD.id, statuses: ["in_progress"] })).map((task) => task.key)).toEqual(["TSK-1"]);
  });

  it("keeps comments and labels", async () => {
    const store = await open();
    const created = await store.createTask({ projectId: BOARD.id, title: "Glow" });
    await store.createComment({ taskId: created.id, kind: "agent", authorName: "agent", body: "Started." });
    await store.addTaskLabel(created.id, "shader");
    expect((await store.listComments(created.id)).map((comment) => comment.body)).toEqual(["Started."]);
    expect((await store.getTask(created.id))?.labelIds).toEqual(["shader"]);
  });

  it("deletes a task for good", async () => {
    const store = await open();
    const created = await store.createTask({ projectId: BOARD.id, title: "Glow" });
    expect(await store.deleteTask(created.id)).toBe(true);
    expect(await store.getTask(created.id)).toBeUndefined();
  });
});

describe("a database board seen from two machines", () => {
  it("names a task the source it came from: the database, with the row version", async () => {
    const fake = newDatabase();
    const { store } = await databaseMachine(fake);
    const created = await store.createTask({ projectId: BOARD.id, title: "Glow" });
    const read = await store.getTask(created.id);
    expect(read?.source?.origin).toEqual({ kind: "database", url: URL_ });
    expect(typeof (read?.source as { revision?: unknown } | null)?.revision).toBe("number");
  });

  it("gives two tasks created at once on two machines two different keys", async () => {
    const fake = newDatabase();
    const a = await databaseMachine(fake);
    const b = await databaseMachine(fake);
    const [one, two] = await Promise.all([
      a.store.createTask({ projectId: BOARD.id, title: "From A" }),
      b.store.createTask({ projectId: BOARD.id, title: "From B" }),
    ]);
    expect(new Set([one.key, two.key])).toEqual(new Set(["TSK-1", "TSK-2"]));
  });

  it("shows one machine's edit on the other after a sync", async () => {
    const fake = newDatabase();
    const a = await databaseMachine(fake);
    const b = await databaseMachine(fake);
    const created = await a.store.createTask({ projectId: BOARD.id, title: "Glow" });
    await a.store.updateTask(created.id, { status: "in_review" });
    await b.repo.sync();
    expect((await b.store.getTask(created.id))?.status).toBe("in_review");
  });

  it("redoes a write made from a stale read instead of losing the other machine's edit", async () => {
    const fake = newDatabase();
    const a = await databaseMachine(fake);
    const b = await databaseMachine(fake);
    const created = await a.store.createTask({ projectId: BOARD.id, title: "Glow" });
    await b.repo.sync();
    await a.store.updateTask(created.id, { title: "Glow brighter" });
    await b.store.updateTask(created.id, { priority: "urgent" });
    await a.repo.sync();
    expect(await a.store.getTask(created.id)).toMatchObject({ title: "Glow brighter", priority: "urgent" });
  });

  it("creates a task in the database even when asked from a thread's worktree", async () => {
    const worktree = tempDir("store-db-worktree-");
    const caller: CallerEnvironment = {
      environmentId: "env_1",
      projectId: "proj_x",
      path: worktree,
      name: "agent-x",
      branchName: "bb/thr_x",
      isWorktree: true,
      hostId: "host_1",
    };
    const fake = newDatabase();
    const board: BoardConfig = { ...BOARD, linkedBbProjectId: "proj_x", tasksFolder: "docs/tasks", database: { url: URL_ } };
    const store = createFileTasksStore(fakeKv(), [board], [], [], [], () => {}, () => caller);
    setBoardRepo(store, board.id, await openRepo(fake));
    const created = await store.createTask({ projectId: board.id, title: "Glow" });
    expect(created.key).toBe("TSK-1");
    expect((await store.getTask(created.id))?.source?.origin).toEqual({ kind: "database", url: URL_ });
    expect(readdirSync(worktree)).toEqual([]);
  });

  it("has no epic folders to migrate", async () => {
    const fake = newDatabase();
    const { store } = await databaseMachine(fake);
    await store.createTask({ projectId: BOARD.id, title: "Glow", assignee: "Claude", epic: "Launch" });
    expect(await store.migrateEpics(BOARD.id, false)).toEqual([]);
  });
});

describe("a database board without its database", () => {
  it("answers unreachable rather than an empty board when no repository is set", async () => {
    const store = createFileTasksStore(fakeKv(), [{ ...BOARD, database: { url: URL_ } }], [], [], [], () => {});
    const error = await store.listTasks({ projectId: BOARD.id }).then(
      () => expect.fail("expected the board to be unreachable"),
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(DatabaseUnreachable);
  });

  it("refuses a write once the database is offline", async () => {
    const fake = newDatabase();
    const { store, repo } = await databaseMachine(fake);
    const created = await store.createTask({ projectId: BOARD.id, title: "Glow" });
    fake.setOffline(true);
    for (let attempt = 0; attempt < 3; attempt += 1) await repo.sync().catch(() => undefined);
    const error = await store.updateTask(created.id, { title: "Offline edit" }).then(
      () => expect.fail("expected the write to be refused"),
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(DatabaseUnreachable);
    expect((await store.getTask(created.id))?.title).toBe("Glow");
  });
});

describe("a board is made a database board", () => {
  it("keeps the address it was created with", () => {
    const store = createFileTasksStore(fakeKv(), [], [], [], [], () => {});
    const created = store.createProject({ name: "Remote", prefix: "REM", color: "blue", database: { url: URL_ } } as Parameters<Store["createProject"]>[0]);
    expect(store.getProject(created.id)?.database).toEqual({ url: URL_ });
  });
});
