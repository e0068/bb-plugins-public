// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { createDbRepo, type DbRepo } from "./db-repo.js";
import { parseTableId } from "./db-tables.js";
import { createFileTasksStore } from "./store.js";
import { readBoardConfigs, type BoardConfig, type KvStore } from "./board-config.js";
import { LABEL_COLOR } from "../shared/enums.js";

const HOST = "board-me.turso.io";
const URL_ = `libsql://${HOST}`;
const DOCS = parseTableId("docs0001")!;
const SECTION: BoardConfig = {
  id: "01M0T4QGCQ3BYK15NH50AD38RV",
  name: "Docs",
  prefix: "DOC",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  database: { url: URL_, table: DOCS },
  createdAt: "2026-01-01T00:00:00.000Z",
};
const RED = "#ef4444";
const BLUE = "#3b82f6";

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key) as never, set: async (key, value) => void map.set(key, structuredClone(value)) };
}

const repos: DbRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.stop();
});

async function machine(kv = fakeKv(), boards: BoardConfig[] = [SECTION]) {
  const fake = createHranaFake();
  fake.addDatabase(HOST, "t1");
  const store = createFileTasksStore(kv, boards, [], [], [], () => {});
  const repo = createDbRepo(createHranaClient({ url: URL_, token: "t1", fetch: fake.fetch }), { url: URL_, table: DOCS });
  repos.push(repo);
  await repo.sync();
  store.setBoardRepo(SECTION.id, repo);
  return { store, kv };
}

const shown = (labels: readonly { name: string; color: string }[]) => labels.map(({ name, color }) => ({ name, color }));

describe("labels added in Manage → Labels", () => {
  it("are listed before any record carries them, in their colour, and stay after a restart", async () => {
    const { store, kv } = await machine();

    store.createLabel({ projectId: SECTION.id, name: "urgent", color: RED });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown(await store.listLabels(SECTION.id))).toEqual([{ name: "urgent", color: RED }]);
    const again = await machine(kv, await readBoardConfigs(kv));
    expect(shown(await again.store.listLabels(SECTION.id))).toEqual([{ name: "urgent", color: RED }]);
  });

  it("keep a new colour, and a picked label shows on the record in it", async () => {
    const { store } = await machine();
    store.createLabel({ projectId: SECTION.id, name: "urgent", color: RED });
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    await store.addTaskLabel(record.id, "urgent");

    await store.updateLabel("urgent", { color: BLUE });

    expect(shown(await store.listLabels(SECTION.id))).toEqual([{ name: "urgent", color: BLUE }]);
    expect(shown(await store.listLabelsForTask(record.id))).toEqual([{ name: "urgent", color: BLUE }]);
  });

  it("rename the label on every record that carries it", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    await store.addTaskLabel(record.id, "urgent");

    await store.updateLabel("urgent", { name: "now" });

    expect((await store.getTask(record.id))!.labelIds).toEqual(["now"]);
    expect(shown(await store.listLabels(SECTION.id))).toEqual([{ name: "now", color: LABEL_COLOR }]);
  });

  it("go away when deleted, even when no record carries them", async () => {
    const { store } = await machine();
    store.createLabel({ projectId: SECTION.id, name: "urgent", color: RED });

    expect(await store.deleteLabel("urgent")).toBe(true);

    expect(await store.listLabels(SECTION.id)).toEqual([]);
  });
});

describe("a label on two boards", () => {
  it("takes its new colour on both", async () => {
    const OTHER: BoardConfig = { ...SECTION, id: "01M0T4QGCQ3BYK15NH50AD38RW", name: "Notes", prefix: "NOT", database: null, tasksFolder: null };
    const { store } = await machine(fakeKv(), [OTHER, SECTION]);
    store.createLabel({ projectId: OTHER.id, name: "urgent", color: RED });
    store.createLabel({ projectId: SECTION.id, name: "urgent", color: RED });

    await store.updateLabel("urgent", { color: BLUE });

    expect(shown(await store.listLabels(OTHER.id))).toEqual([{ name: "urgent", color: BLUE }]);
    expect(shown(await store.listLabels(SECTION.id))).toEqual([{ name: "urgent", color: BLUE }]);
  });
});

describe("a rename while the record's labels change", () => {
  it("keeps the label added meanwhile", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    await store.addTaskLabel(record.id, "urgent");

    await Promise.all([store.updateLabel("urgent", { name: "now" }), store.addTaskLabel(record.id, "later")]);

    expect([...(await store.getTask(record.id))!.labelIds].sort()).toEqual(["later", "now"]);
  });
});

describe("labels changed with the rest of a record", () => {
  it("land in the same write", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });

    await store.updateTask(record.id, { title: "First day", labelIds: ["urgent", "later", "urgent"] });

    expect(await store.getTask(record.id)).toMatchObject({ title: "First day", labelIds: ["urgent", "later"] });
  });
});
