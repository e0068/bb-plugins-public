// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { createDbRepo, type DbRepo } from "./db-repo.js";
import { parseTableId } from "./db-tables.js";
import { createFileTasksStore } from "./store.js";
import { readBoardConfigs, type BoardConfig, type KvStore } from "./board-config.js";
import { parseFrontmatter } from "./frontmatter.js";
import { mapFrontmatter } from "./map.js";

const HOST = "board-me.turso.io";
const URL_ = `libsql://${HOST}`;
const DOCS = parseTableId("docs0001")!;
const BOARD: BoardConfig = {
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

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key) as never, set: async (key, value) => void map.set(key, structuredClone(value)) };
}

const repos: DbRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.stop();
});

async function machine(kv = fakeKv(), boards: BoardConfig[] = [BOARD]) {
  const fake = createHranaFake();
  fake.addDatabase(HOST, "t1");
  const store = createFileTasksStore(kv, boards, [], [], [], () => {});
  const repo = createDbRepo(createHranaClient({ url: URL_, token: "t1", fetch: fake.fetch }), { url: URL_, table: DOCS });
  repos.push(repo);
  await repo.sync();
  store.setBoardRepo(BOARD.id, repo);
  return { store, kv, repo };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const frontmatterOf = (repo: DbRepo) => [...repo.snapshot().values()].map((text) => parseFrontmatter(text).data);

describe("a task's or a record's icon", () => {
  it("is written into the file as icon: and read back, of every kind", async () => {
    const { store, repo } = await machine();
    const record = await store.createTask({ projectId: BOARD.id, title: "Onboarding" });

    for (const icon of ["Rocket", "filled:Rocket", "🚀"]) {
      await store.updateTask(record.id, { icon });
      expect((await store.getTask(record.id))?.icon).toBe(icon);
      expect(frontmatterOf(repo)[0]?.icon).toBe(icon);
    }
  });

  it("comes off the file when cleared", async () => {
    const { store, repo } = await machine();
    const record = await store.createTask({ projectId: BOARD.id, title: "Onboarding" });
    await store.updateTask(record.id, { icon: "🚀" });

    await store.updateTask(record.id, { icon: null });

    expect((await store.getTask(record.id))?.icon).toBeUndefined();
    expect(frontmatterOf(repo)[0]).not.toHaveProperty("icon");
  });

  it("is not one of the record's own fields", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: BOARD.id, title: "Onboarding" });
    await store.updateTask(record.id, { icon: "🚀" });

    expect((await store.getTask(record.id))?.properties ?? {}).not.toHaveProperty("icon");
  });

  it("is read only when the file names an icon", () => {
    expect(mapFrontmatter({ icon: "🚀" }, "todo", "a").icon).toBe("🚀");
    expect(mapFrontmatter({ icon: "NoSuchIcon" }, "todo", "a").icon).toBeUndefined();
    expect(mapFrontmatter({ icon: 7 }, "todo", "a").icon).toBeUndefined();
  });
});

describe("a label's icon", () => {
  it("is kept beside its colour, through a rename and a recolour, and after a restart", async () => {
    const { store, kv } = await machine();
    store.createLabel({ projectId: BOARD.id, name: "urgent", color: "#ef4444" });
    await settle();

    await store.updateLabel("urgent", { icon: "filled:Fire" });
    await store.updateLabel("urgent", { name: "hot", color: "#3b82f6" });
    await settle();

    expect((await store.listLabels(BOARD.id)).map(({ name, icon }) => ({ name, icon }))).toEqual([{ name: "hot", icon: "filled:Fire" }]);
    const again = await machine(kv, await readBoardConfigs(kv));
    expect((await again.store.listLabels(BOARD.id))[0]?.icon).toBe("filled:Fire");
  });

  it("comes off when cleared", async () => {
    const { store } = await machine();
    store.createLabel({ projectId: BOARD.id, name: "urgent", color: "#ef4444" });
    await store.updateLabel("urgent", { icon: "🔥" });

    await store.updateLabel("urgent", { icon: null });

    expect((await store.listLabels(BOARD.id))[0]).not.toHaveProperty("icon");
  });
});

describe("a board's column icons", () => {
  it("are kept by the board and after a restart; a cleared one comes off", async () => {
    const { store, kv } = await machine();

    store.updateProject(BOARD.id, { columnIcons: { status: "🚦", title: "filled:Edit02" } });
    await settle();
    store.updateProject(BOARD.id, { columnIcons: { title: "filled:Edit02" } });
    await settle();

    expect(store.getProject(BOARD.id)?.columnIcons).toEqual({ title: "filled:Edit02" });
    const again = await machine(kv, await readBoardConfigs(kv));
    expect(again.store.getProject(BOARD.id)?.columnIcons).toEqual({ title: "filled:Edit02" });
  });
});
