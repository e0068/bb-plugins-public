// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

const storePath = "./store.js";
const dbRepoPath = "./db-repo.js";
const hranaPath = "../remote/hrana.js";
const { TaskAlreadyTaken } = await planned<typeof import("./store.js")>(() => import(/* @vite-ignore */ storePath));
const { createDbRepo } = await planned<typeof import("./db-repo.js")>(() => import(/* @vite-ignore */ dbRepoPath));
const { createHranaClient } = await planned<typeof import("../remote/hrana.js")>(() => import(/* @vite-ignore */ hranaPath));

type Store = ReturnType<typeof createFileTasksStore>;
type TakenBy = import("../shared/task-claim.js").TakenBy;

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
  return { get: async (key) => map.get(key) as never, set: async (key, value) => void map.set(key, structuredClone(value)) };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A store that stamps `machine` on what it takes: the ninth argument of createFileTasksStore. */
function storeOn(machine: string, boards: BoardConfig[]): Store {
  const create = createFileTasksStore as unknown as (...args: unknown[]) => Store;
  return create(fakeKv(), boards, [], [], [], () => {}, () => null, {}, machine);
}

/** One machine on the shared database board. */
async function databaseMachine(fake: HranaFake, machine: string) {
  const store = storeOn(machine, [{ ...BOARD, database: { url: URL_ } }]);
  const repo = createDbRepo(createHranaClient({ url: URL_, token: "t1", fetch: fake.fetch }), { url: URL_ });
  cleanups.push(() => repo.stop());
  await repo.sync();
  (store as unknown as { setBoardRepo: (id: string, repo: unknown) => void }).setBoardRepo(BOARD.id, repo);
  return { store, repo };
}

async function twoMachines() {
  const fake = createHranaFake();
  fake.addDatabase(HOST, "t1");
  const mini = await databaseMachine(fake, "Mac mini");
  const book = await databaseMachine(fake, "MacBook");
  const task = await mini.store.createTask({ projectId: BOARD.id, title: "Glow", status: "todo" });
  await book.repo.sync();
  return { mini, book, task };
}

async function refusal(promise: Promise<unknown>): Promise<{ key: string; takenBy: TakenBy }> {
  const error = await promise.then(
    () => expect.fail("expected the task to be refused as already taken"),
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(TaskAlreadyTaken);
  return error as { key: string; takenBy: TakenBy };
}

describe("taking a task on a board two machines share", () => {
  it("of two machines taking one task at once, exactly one gets it and the other hears who", async () => {
    const { mini, book, task } = await twoMachines();
    const outcomes = await Promise.allSettled([
      mini.store.updateTask(task.id, { status: "in_progress" }),
      book.store.updateTask(task.id, { status: "in_progress" }),
    ]);
    const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const lost = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const winner = outcomes[0]!.status === "fulfilled" ? "Mac mini" : "MacBook";
    expect(lost[0]!.reason).toBeInstanceOf(TaskAlreadyTaken);
    expect(lost[0]!.reason).toMatchObject({ key: "TSK-1", takenBy: { machine: winner } });
  });

  it("stamps the machine on the task it takes", async () => {
    const { mini, book, task } = await twoMachines();
    await mini.store.updateTask(task.id, { status: "in_progress" });
    await book.repo.sync();
    expect((await book.store.getTask(task.id))?.takenBy).toMatchObject({ machine: "Mac mini" });
  });

  it("refuses a task in review that another machine holds", async () => {
    const { mini, book, task } = await twoMachines();
    await mini.store.updateTask(task.id, { status: "in_progress" });
    await mini.store.updateTask(task.id, { status: "in_review" });
    await book.repo.sync();
    const refused = await refusal(book.store.updateTask(task.id, { status: "in_progress" }));
    expect(refused.takenBy.machine).toBe("Mac mini");
  });

  it("lets the same machine take its task again from a second thread and keeps the first mark", async () => {
    const { mini, task } = await twoMachines();
    await mini.store.upsertTaskThread({ taskId: task.id, threadId: "thr_first", presetName: "Manual", title: "First" });
    await mini.store.upsertTaskThread({ taskId: task.id, threadId: "thr_second", presetName: "Manual", title: "Second" });
    expect((await mini.store.getTask(task.id))?.takenBy).toMatchObject({ machine: "Mac mini", threadId: "thr_first" });
  });

  it("frees the task when it goes back to todo, and then another machine takes it", async () => {
    const { mini, book, task } = await twoMachines();
    await mini.store.updateTask(task.id, { status: "in_progress" });
    await mini.store.updateTask(task.id, { status: "todo" });
    expect((await mini.store.getTask(task.id))?.takenBy ?? null).toBeNull();
    await book.repo.sync();
    await book.store.updateTask(task.id, { status: "in_progress" });
    expect((await book.store.getTask(task.id))?.takenBy).toMatchObject({ machine: "MacBook" });
  });

  it("lets another machine edit a field of a held task without taking it", async () => {
    const { mini, book, task } = await twoMachines();
    await mini.store.updateTask(task.id, { status: "in_progress" });
    await book.repo.sync();
    await book.store.updateTask(task.id, { priority: "high" });
    expect(await book.store.getTask(task.id)).toMatchObject({ priority: "high", status: "in_progress", takenBy: { machine: "Mac mini" } });
  });

  it("does not attach a thread to a task another machine holds", async () => {
    const { mini, book, task } = await twoMachines();
    await mini.store.updateTask(task.id, { status: "in_progress" });
    await book.repo.sync();
    await refusal(book.store.upsertTaskThread({ taskId: task.id, threadId: "thr_book", presetName: "Manual", title: "Book" }));
    await book.repo.sync();
    expect((await book.store.listTaskThreads(task.id)).map((thread) => thread.threadId)).toEqual([]);
  });

  it("marks a task created straight into progress as taken by its machine", async () => {
    const fake = createHranaFake();
    fake.addDatabase(HOST, "t1");
    const { store } = await databaseMachine(fake, "Mac mini");
    const created = await store.createTask({ projectId: BOARD.id, title: "Hot", status: "in_progress" });
    expect((await store.getTask(created.id))?.takenBy).toMatchObject({ machine: "Mac mini", threadId: null });
  });
});

describe("taking a task on a folder board", () => {
  it("writes the mark into the task file, and a second machine reading that file is refused", async () => {
    const root = mkdtempSync(join(tmpdir(), "store-claim-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const mini = storeOn("Mac mini", [BOARD]);
    const book = storeOn("MacBook", [BOARD]);
    for (const store of [mini, book]) store.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
    const task = await mini.createTask({ projectId: BOARD.id, title: "Glow", status: "todo" });
    const taken = await mini.updateTask(task.id, { status: "in_progress" });
    expect(readFileSync(taken.source!.filePath, "utf8")).toContain("taken_by:");
    const refused = await refusal(book.updateTask(task.id, { status: "in_progress", title: "Mine now" }));
    expect(refused.takenBy.machine).toBe("Mac mini");
    expect((await mini.getTask(task.id))?.title).toBe("Glow");
  });
});
