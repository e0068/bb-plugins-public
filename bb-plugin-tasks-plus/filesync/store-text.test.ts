// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { createDbRepo, type DbRepo } from "./db-repo.js";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

const HOST = "board-me.turso.io";
const URL_ = `libsql://${HOST}`;
const BOARD: BoardConfig = {
  id: "01M0T4QGCQ3BYK15NH50AD38RV",
  name: "Docs",
  prefix: "DOC",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  database: { url: URL_ },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key) as never,
    set: async (key, value) => void map.set(key, structuredClone(value)),
  };
}

const repos: DbRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.stop();
});

/** One machine's store on the database board. */
async function machine(fake: HranaFake) {
  const store = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  const repo = createDbRepo(createHranaClient({ url: URL_, token: "t1", fetch: fake.fetch }), { url: URL_ });
  repos.push(repo);
  await repo.sync();
  store.setBoardRepo(BOARD.id, repo);
  return { store, repo };
}

async function twoMachines() {
  const fake = createHranaFake();
  fake.addDatabase(HOST, "t1");
  return { a: await machine(fake), b: await machine(fake) };
}

describe("a record's whole text, as the document view reads and saves it", () => {
  it("reads the record's text with its frontmatter, and saves an edit that every machine then reads", async () => {
    const { a, b } = await twoMachines();
    const record = await a.store.createTask({ projectId: BOARD.id, title: "Onboarding", description: "First day" });

    const read = await a.store.readTaskText(record.id);
    expect(read?.content).toContain("title: Onboarding");
    expect(read?.content).toContain("First day");

    const edited = read!.content.replace("First day", "First week");
    const saved = await a.store.writeTaskText(record.id, edited, read!.sha256);
    expect(saved).toMatchObject({ outcome: "written" });

    await b.repo.sync();
    expect((await b.store.readTaskText(record.id))?.content).toContain("First week");
    expect((await b.store.getTask(record.id))?.description).toContain("First week");
  });

  it("refuses to save over an edit it did not see, and keeps that edit", async () => {
    const { a, b } = await twoMachines();
    const record = await a.store.createTask({ projectId: BOARD.id, title: "Onboarding", description: "First day" });
    const seenByA = (await a.store.readTaskText(record.id))!;

    await b.repo.sync();
    const seenByB = (await b.store.readTaskText(record.id))!;
    await b.store.writeTaskText(record.id, seenByB.content.replace("First day", "Colleague's edit"), seenByB.sha256);
    await a.repo.sync();

    expect(await a.store.writeTaskText(record.id, seenByA.content.replace("First day", "Mine"), seenByA.sha256)).toEqual({ outcome: "conflict" });
    expect((await a.store.readTaskText(record.id))?.content).toContain("Colleague's edit");
  });

  it("answers not-found for a record that is not there", async () => {
    const { a } = await twoMachines();
    expect(await a.store.readTaskText(`${BOARD.id}:missing`)).toBeNull();
    expect(await a.store.writeTaskText(`${BOARD.id}:missing`, "text", null)).toEqual({ outcome: "not-found" });
  });
});
