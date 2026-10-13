// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { createDbRepo, type DbRepo } from "./db-repo.js";
import { parseTableId } from "./db-tables.js";
import { renderTaskFile } from "./task-file.js";

const HOST = "board-me.turso.io";
const NO_PLACEMENT = { assignee: null, epic: null };
const DOCS = parseTableId("docs0001")!;
const SPECS = parseTableId("specs001")!;

const opened: DbRepo[] = [];
afterEach(() => {
  for (const repo of opened.splice(0)) repo.stop();
});

function database() {
  const fake = createHranaFake();
  const { url } = fake.addDatabase(HOST, "t1");
  const client = () => createHranaClient({ url, token: "t1", fetch: fake.fetch });
  const open = (options: { table?: typeof DOCS; onChange?: () => void } = {}) => {
    const repo = createDbRepo(createHranaClient({ url, token: "t1", fetch: fake.fetch }), { url, ...options });
    opened.push(repo);
    return repo;
  };
  return { url, open, client };
}

const record = (title: string, slug: string) => ({
  status: "todo" as const,
  slug,
  placement: NO_PLACEMENT,
  content: renderTaskFile({ title }, slug, []),
});

describe("tables beside the task board of a database", () => {
  it("keeps a table's records apart from the task board, under the table's own root", async () => {
    const { url, open } = database();
    const board = open();
    const docs = open({ table: DOCS });
    await board.sync();
    await docs.sync();

    const written = await docs.write(record("Onboarding", "onboarding"));

    expect(written.filePath.startsWith(`${url}/tables/${DOCS}/`)).toBe(true);
    await board.sync();
    await docs.sync();
    expect(await board.list()).toEqual([]);
    expect((await docs.list()).map((file) => file.slug)).toEqual(["onboarding"]);
  });

  it("tells a second machine about a table added on the first", async () => {
    const { open } = database();
    const first = open();
    const onChange = vi.fn();
    const second = open({ onChange });
    await first.sync();
    await second.sync();
    onChange.mockClear();

    const added = await first.addTable(DOCS, "Docs", null);
    await second.sync();

    expect(added).toEqual({ id: DOCS, name: "Docs", parent: null, fields: [] });
    expect(first.tables()).toEqual([{ id: DOCS, name: "Docs", parent: null, fields: [] }]);
    expect(second.tables()).toEqual([{ id: DOCS, name: "Docs", parent: null, fields: [] }]);
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps each table's name and prefix in its own head, not in the task board's", async () => {
    const { open } = database();
    const board = open();
    const docs = open({ table: DOCS });
    await board.sync();
    await docs.sync();
    await board.writeBoard({ name: "Tasks", prefix: "TSK" });

    await docs.writeBoard({ name: "Docs", prefix: "DOC" });
    await board.sync();

    expect(await board.readBoard()).toEqual({ name: "Tasks", prefix: "TSK" });
    expect(await docs.readBoard()).toEqual({ name: "Docs", prefix: "DOC" });
  });

  it("tells a second machine which section a section sits in", async () => {
    const { open } = database();
    const first = open();
    const second = open();
    await first.sync();
    await second.sync();

    await first.addTable(DOCS, "Docs", null);
    await first.addTable(SPECS, "Specs", DOCS);
    await second.sync();

    expect(second.tables()).toEqual([
      { id: DOCS, name: "Docs", parent: null, fields: [] },
      { id: SPECS, name: "Specs", parent: DOCS, fields: [] },
    ]);
  });

  it("opens a database whose list of sections was made before sections nested, and keeps its sections on top", async () => {
    const { open, client } = database();
    const old = client();
    await old.execute("CREATE TABLE tables (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)");
    await old.execute("INSERT INTO tables (id, name, created_at) VALUES (?, ?, ?)", [DOCS, "Docs", "2026-10-13T00:00:00.000Z"]);
    const board = open();
    await board.sync();
    await board.addTable(SPECS, "Specs", DOCS);
    const again = open();
    await again.sync();

    expect(again.tables()).toEqual([
      { id: DOCS, name: "Docs", parent: null, fields: [] },
      { id: SPECS, name: "Specs", parent: DOCS, fields: [] },
    ]);
  });

  it("tells a second machine the fields a section was given, in the order they were added", async () => {
    const { open } = database();
    const first = open();
    const onChange = vi.fn();
    const second = open({ onChange });
    await first.sync();
    await first.addTable(DOCS, "Docs", null);
    await second.sync();
    onChange.mockClear();

    await first.addTableField(DOCS, { name: "size", type: "number" });
    await second.addTableField(DOCS, { name: "done", type: "checkbox" });
    await first.sync();
    await second.sync();

    const fields = [
      { name: "size", type: "number" },
      { name: "done", type: "checkbox" },
    ];
    expect(first.tables()).toEqual([{ id: DOCS, name: "Docs", parent: null, fields }]);
    expect(second.tables()).toEqual([{ id: DOCS, name: "Docs", parent: null, fields }]);
    expect(onChange).toHaveBeenCalled();
  });

  it("opens a database whose list of sections has no fields yet, and gives its sections fields", async () => {
    const { open, client } = database();
    const old = client();
    await old.execute("CREATE TABLE tables (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, parent TEXT)");
    await old.execute("INSERT INTO tables (id, name, created_at) VALUES (?, ?, ?)", [DOCS, "Docs", "2026-10-13T00:00:00.000Z"]);
    const board = open();
    await board.sync();
    await board.addTableField(DOCS, { name: "link", type: "url" });
    const again = open();
    await again.sync();

    expect(again.tables()).toEqual([{ id: DOCS, name: "Docs", parent: null, fields: [{ name: "link", type: "url" }] }]);
  });
});
