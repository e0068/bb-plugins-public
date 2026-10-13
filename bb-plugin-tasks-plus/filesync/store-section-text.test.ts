// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { createDbRepo, type DbRepo } from "./db-repo.js";
import { parseTableId } from "./db-tables.js";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

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

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key) as never, set: async (key, value) => void map.set(key, structuredClone(value)) };
}

const repos: DbRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.stop();
});

async function machine() {
  const fake = createHranaFake();
  fake.addDatabase(HOST, "t1");
  const store = createFileTasksStore(fakeKv(), [SECTION], [], [], [], () => {});
  const repo = createDbRepo(createHranaClient({ url: URL_, token: "t1", fetch: fake.fetch }), { url: URL_, table: DOCS });
  repos.push(repo);
  await repo.sync();
  store.setBoardRepo(SECTION.id, repo);
  return { store, repo };
}

describe("a section's record in Kasimov", () => {
  it("opens with the record's title, the section's fields and its dates — not the board's slug and key", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding", description: "First day" });

    const text = (await store.readTaskText(record.id))!.content;

    expect(text).toMatch(/^---\ntitle: Onboarding\ntags:\ndate:\ncreated: \S+\nupdated: \S+\n---\n\nFirst day/);
    expect(text).not.toMatch(/^(slug|key|status|priority):/m);
  });

  it("shows a field another record of the section has", async () => {
    const { store } = await machine();
    const first = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    const second = await store.createTask({ projectId: SECTION.id, title: "Offboarding" });
    const shown = (await store.readTaskText(first.id))!;
    await store.writeTaskText(first.id, shown.content.replace("date:", "date:\nowner: Ann"), shown.sha256);

    expect((await store.readTaskText(second.id))!.content).toMatch(/^owner:$/m);
  });

  it("saves a field's value into the record, where the list reads it", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    const shown = (await store.readTaskText(record.id))!;

    expect(await store.writeTaskText(record.id, shown.content.replace("date:", "date: 2026-10-14"), shown.sha256)).toMatchObject({ outcome: "written" });

    expect((await store.getTask(record.id))?.properties).toMatchObject({ date: "2026-10-14" });
  });

  it("saves the Tags written in Kasimov as the record's labels, which the card and the table show", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    const shown = (await store.readTaskText(record.id))!;

    await store.writeTaskText(record.id, shown.content.replace("tags:", "tags: hr, urgent"), shown.sha256);

    const saved = await store.getTask(record.id);
    expect(saved?.labelIds).toEqual(["hr", "urgent"]);
    expect(saved?.properties).not.toHaveProperty("tags");
    expect((await store.readTaskText(record.id))!.content).toMatch(/^tags: hr, urgent$/m);
  });

  it("does not save a date changed by hand", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    const shown = (await store.readTaskText(record.id))!;

    await store.writeTaskText(record.id, shown.content.replace(/^created: .*$/m, "created: 1999-01-01"), shown.sha256);

    expect((await store.readTaskText(record.id))!.content).not.toContain("1999-01-01");
  });

  it("saves twice in a row from one view without a false conflict, though the change date moves", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    const shown = (await store.readTaskText(record.id))!;
    const once = await store.writeTaskText(record.id, shown.content.replace("tags:", "tags: a"), shown.sha256);
    const sha = once.outcome === "written" ? once.sha256 : "";

    expect(await store.writeTaskText(record.id, shown.content.replace("tags:", "tags: b"), sha)).toMatchObject({ outcome: "written" });
  });

  it("refuses fields that do not read and keeps the record as it was", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding" });
    const shown = (await store.readTaskText(record.id))!;

    expect(await store.writeTaskText(record.id, shown.content.replace("tags:", "tags: [unclosed"), shown.sha256)).toEqual({ outcome: "invalid" });
    expect((await store.readTaskText(record.id))!.content).toBe(shown.content);
  });
});

describe("a record changed from one machine at once", () => {
  it("keeps every image uploaded while its description is being saved, with no write refused", async () => {
    const { store } = await machine();
    const record = await store.createTask({ projectId: SECTION.id, title: "Onboarding", description: "x" });
    const writes = [0, 1, 2, 3].flatMap((i) => [
      store.updateTask(record.id, { description: `draft ${i}` }),
      store.createAttachment({ taskId: record.id, fileName: `shot-${i}.png`, mime: "image/png", sizeBytes: 1, blobPath: `blob-${i}`, isImage: true }),
    ]);

    const outcomes = await Promise.allSettled(writes);

    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([]);
    expect((await store.listAttachmentsForTask(record.id)).map((attachment) => attachment.fileName).sort()).toEqual(["shot-0.png", "shot-1.png", "shot-2.png", "shot-3.png"]);
    expect((await store.getTask(record.id))?.description).toBe("draft 3");
  });
});
