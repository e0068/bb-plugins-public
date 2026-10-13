// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";

let hrana: HranaFake;
const hosts: TasksHost[] = [];
const dirs: string[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  vi.stubGlobal("fetch", hrana.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function machine(name: string) {
  const host = await tasksHost({ machine: name });
  hosts.push(host);
  return host;
}

type Invite = { ok: true; invite: string } | { ok: false };
type Created = { ok: true; boardId: string } | { ok: false; message: string };
type Project = {
  id: string;
  name: string;
  prefix: string;
  database?: { url: string; table?: string; parent?: string; fields?: { name: string; type: string; options?: string[] }[] } | null;
};
type Rows = { projects: { board: { id: string } | null }[]; orphans: { id: string }[] };

/** Two machines on the task board TSK kept in one database. */
async function sharedProject() {
  hrana.addDatabase("team-me.turso.io", "owner-token");
  const a = await machine("Mac mini");
  await a.call("connectDatabase", { url: "libsql://team-me.turso.io", token: "owner-token", name: "Team", prefix: "TSK" });
  const board = (await boardByPrefix(a, "TSK"))!;
  const invite = await a.call<Invite>("databaseInvite", { boardId: board.id });
  const b = await machine("MacBook");
  await b.call("connectDatabase", { url: invite.ok ? invite.invite : "" });
  const onB = (await boardByPrefix(b, "TSK"))!;
  return { a, b, board, onB };
}

const projects = async (host: TasksHost) => (await host.call<{ projects: Project[] }>("listProjects", {})).projects;

describe("Tables beside a project's task board, in its database", () => {
  it("shows a table added on one machine on the other, and keeps its records off the task board", async () => {
    const { a, b, board, onB } = await sharedProject();

    const created = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    expect(created).toMatchObject({ ok: true });
    const tableId = created.ok ? created.boardId : "";
    await a.call("createTask", { projectId: tableId, title: "Onboarding" });

    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () => expect((await projects(b)).map((project) => project.name)).toContain("Docs"));
    const docsOnB = (await projects(b)).find((project) => project.name === "Docs")!;
    expect(docsOnB.database).toMatchObject({ url: expect.stringContaining("team-me.turso.io") });
    expect(docsOnB.database?.table).toEqual(expect.any(String));

    await b.call("retryDatabase", { boardId: docsOnB.id });
    await vi.waitFor(async () => {
      const records = (await b.call<{ tasks: { title: string }[] }>("listTasks", { projectId: docsOnB.id })).tasks;
      expect(records.map((task) => task.title)).toEqual(["Onboarding"]);
    });
    const onTaskBoard = (await b.call<{ tasks: { title: string }[] }>("listTasks", { projectId: onB.id })).tasks;
    expect(onTaskBoard.map((task) => task.title)).not.toContain("Onboarding");
  });

  it("refuses a second table under a name the project already has, whatever its case", async () => {
    const { a, board } = await sharedProject();
    expect(await a.call<Created>("createTable", { boardId: board.id, name: "Notes" })).toMatchObject({ ok: true });
    expect(await a.call<Created>("createTable", { boardId: board.id, name: "notes" })).toMatchObject({ ok: false, message: expect.stringMatching(/already/) });
    expect((await projects(a)).filter((project) => project.name.toLowerCase() === "notes")).toHaveLength(1);
  });

  it("refuses a table on a board that lives in no database", async () => {
    const { a } = await sharedProject();
    expect(await a.call<Created>("createTable", { boardId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "Docs" })).toMatchObject({ ok: false });
  });

  it("keeps a table out of the Projects tab rows: it belongs under its task board", async () => {
    const { a, board } = await sharedProject();
    const created = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const rows = await a.call<Rows>("listProjectRows", null);
    const ids = [...rows.projects.flatMap((row) => (row.board === null ? [] : [row.board.id])), ...rows.orphans.map((row) => row.id)];
    expect(ids).toContain(board.id);
    expect(ids).not.toContain(created.ok ? created.boardId : "");
  });

  it("mirrors a table's records into a subfolder of the project's mirror folder", async () => {
    const { a, board } = await sharedProject();
    const dir = mkdtempSync(join(tmpdir(), "database-tables-"));
    dirs.push(dir);
    await a.call("setMirrorFolder", { boardId: board.id, folder: dir });
    const created = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const table = (await projects(a)).find((project) => project.id === (created.ok ? created.boardId : ""))!;

    await a.call("createTask", { projectId: table.id, title: "Onboarding" });

    const file = join(dir, "Docs", `${table.prefix}-1.md`);
    await vi.waitFor(() => expect(existsSync(file) ? readFileSync(file, "utf8") : "").toContain("title: Onboarding"));
  });

  it("takes the project's tables away with it when its database is disconnected", async () => {
    const { a, board } = await sharedProject();
    await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    await a.call("removeSyncedFolder", { projectId: board.id });
    expect((await projects(a)).map((project) => project.name)).not.toContain("Docs");
  });

  it("puts a section inside a section, and the other machine sees it there", async () => {
    const { a, b, board, onB } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const specs = await a.call<Created>("createTable", { boardId: docs.ok ? docs.boardId : "", name: "Specs" });
    expect(specs).toMatchObject({ ok: true });

    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () => expect((await projects(b)).map((project) => project.name)).toContain("Specs"));
    const onBoth = await projects(b);
    const docsOnB = onBoth.find((project) => project.name === "Docs")!;
    const specsOnB = onBoth.find((project) => project.name === "Specs")!;
    expect(docsOnB.database?.parent).toBeUndefined();
    expect(specsOnB.database?.parent).toBe(docsOnB.database?.table);
  });

  it("takes one name twice when the two sections sit in different sections", async () => {
    const { a, board } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const meetings = await a.call<Created>("createTable", { boardId: board.id, name: "Meetings" });
    expect(await a.call<Created>("createTable", { boardId: docs.ok ? docs.boardId : "", name: "Notes" })).toMatchObject({ ok: true });
    expect(await a.call<Created>("createTable", { boardId: meetings.ok ? meetings.boardId : "", name: "Notes" })).toMatchObject({ ok: true });
    expect(await a.call<Created>("createTable", { boardId: docs.ok ? docs.boardId : "", name: "NOTES" })).toMatchObject({ ok: false });
  });

  it("mirrors a section inside a section into a folder inside its parent's folder", async () => {
    const { a, board } = await sharedProject();
    const dir = mkdtempSync(join(tmpdir(), "database-tables-"));
    dirs.push(dir);
    await a.call("setMirrorFolder", { boardId: board.id, folder: dir });
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const specs = await a.call<Created>("createTable", { boardId: docs.ok ? docs.boardId : "", name: "Specs" });
    const section = (await projects(a)).find((project) => project.id === (specs.ok ? specs.boardId : ""))!;

    await a.call("createTask", { projectId: section.id, title: "Mirror" });

    const file = join(dir, "Docs", "Specs", `${section.prefix}-1.md`);
    await vi.waitFor(() => expect(existsSync(file) ? readFileSync(file, "utf8") : "").toContain("title: Mirror"));
  });

  it("moves a section a machine already shows under the parent the database names, as for a board made by an older plugin", async () => {
    const { a, b, board, onB } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const specs = await a.call<Created>("createTable", { boardId: board.id, name: "Specs" });
    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () => expect((await projects(b)).map((project) => project.name)).toContain("Specs"));
    const ids = await projects(a);
    const tableOf = (created: Created) => ids.find((project) => project.id === (created.ok ? created.boardId : ""))?.database?.table;

    // The database learns the parent after the board on B was made — as an older plugin would have made it, with none.
    const db = createHranaClient({ url: "libsql://team-me.turso.io", token: "owner-token", fetch: hrana.fetch });
    await db.execute("UPDATE tables SET parent = ? WHERE id = ?", [tableOf(docs)!, tableOf(specs)!]);
    await db.execute("UPDATE board SET seq = seq + 1 WHERE id = 1");
    await b.call("retryDatabase", { boardId: onB.id });

    await vi.waitFor(async () => expect((await projects(b)).find((project) => project.name === "Specs")?.database?.parent).toBe(tableOf(docs)));
  });

  it("gives a section a property of a type, which the other machine and Kasimov see", async () => {
    const { a, b, board, onB } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const docsId = docs.ok ? docs.boardId : "";

    expect(await a.call("addSectionField", { boardId: docsId, name: "size", type: "number" })).toEqual({ ok: true });
    expect((await projects(a)).find((project) => project.id === docsId)?.database?.fields).toEqual([{ name: "size", type: "number" }]);

    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () =>
      expect((await projects(b)).find((project) => project.name === "Docs")?.database?.fields).toEqual([{ name: "size", type: "number" }]),
    );

    const created = await a.call<{ ok: true; task: { id: string } }>("createTask", { projectId: docsId, title: "Onboarding" });
    const text = await a.call<{ text: { content: string } | null }>("readTaskText", { taskId: created.task.id });
    expect(text.text?.content).toMatch(/\nsize:/);
  });

  it("saves the Tags picked in the card as the record's labels, and writes no activity into its text", async () => {
    const { a, board } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const docsId = docs.ok ? docs.boardId : "";
    const created = await a.call<{ ok: true; task: { id: string } }>("createTask", { projectId: docsId, title: "Onboarding" });

    const updated = await a.call<{ ok: true; task: { labelIds: string[] } }>("updateTask", { taskId: created.task.id, labelIds: ["hr", "urgent"] });

    expect(updated.task.labelIds).toEqual(["hr", "urgent"]);
    const text = (await a.call<{ text: { content: string } | null }>("readTaskText", { taskId: created.task.id })).text?.content ?? "";
    expect(text).toMatch(/^tags: hr, urgent$/m);
    expect(text).not.toMatch(/Comments|comment id=/);
  });

  it("refuses a property the section already has, or on a board that is no section", async () => {
    const { a, board } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const docsId = docs.ok ? docs.boardId : "";

    expect(await a.call("addSectionField", { boardId: docsId, name: "Tags", type: "text" })).toMatchObject({ ok: false, message: expect.stringMatching(/already has/) });
    expect(await a.call("addSectionField", { boardId: board.id, name: "size", type: "number" })).toMatchObject({ ok: false });
  });

  it("keeps the options of a Select made on one machine, added and taken away, for the other", async () => {
    const { a, b, board, onB } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const docsId = docs.ok ? docs.boardId : "";
    await a.call("addSectionField", { boardId: docsId, name: "stage", type: "select" });

    expect(await a.call("changeFieldOption", { boardId: docsId, field: "stage", option: "Idea", change: "add" })).toEqual({ ok: true });
    expect(await a.call("changeFieldOption", { boardId: docsId, field: "stage", option: "Done", change: "add" })).toEqual({ ok: true });
    expect(await a.call("changeFieldOption", { boardId: docsId, field: "stage", option: "idea", change: "add" })).toMatchObject({ ok: false, message: expect.stringMatching(/already/) });
    expect(await a.call("changeFieldOption", { boardId: docsId, field: "stage", option: "IDEA", change: "remove" })).toEqual({ ok: true });

    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () =>
      expect((await projects(b)).find((project) => project.name === "Docs")?.database?.fields).toEqual([{ name: "stage", type: "select", options: ["Done"] }]),
    );
  });

  it("gives the Tags every section starts with options, and refuses options on a field of another type", async () => {
    const { a, board } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const docsId = docs.ok ? docs.boardId : "";

    expect(await a.call("changeFieldOption", { boardId: docsId, field: "tags", option: "urgent", change: "add" })).toEqual({ ok: true });
    expect(await a.call("changeFieldOption", { boardId: docsId, field: "tags", option: "later", change: "add" })).toEqual({ ok: true });
    expect((await projects(a)).find((project) => project.id === docsId)?.database?.fields).toEqual([{ name: "tags", type: "tags", options: ["urgent", "later"] }]);
    expect(await a.call("changeFieldOption", { boardId: docsId, field: "date", option: "x", change: "add" })).toMatchObject({ ok: false });
  });

  it("renames a section for the other machine, and refuses a name a sibling has", async () => {
    const { a, b, board, onB } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    await a.call<Created>("createTable", { boardId: board.id, name: "Notes" });
    const docsId = docs.ok ? docs.boardId : "";

    expect(await a.call("renameSection", { boardId: docsId, name: "notes" })).toMatchObject({ ok: false, message: expect.stringMatching(/already/) });
    expect(await a.call("renameSection", { boardId: docsId, name: "Guides" })).toEqual({ ok: true });
    expect((await projects(a)).find((project) => project.id === docsId)?.name).toBe("Guides");

    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () => expect((await projects(b)).map((project) => project.name)).toContain("Guides"));
    expect((await projects(b)).map((project) => project.name)).not.toContain("Docs");
  });

  it("deletes a section with the sections inside it, on the other machine too, and leaves a project alone", async () => {
    const { a, b, board, onB } = await sharedProject();
    const docs = await a.call<Created>("createTable", { boardId: board.id, name: "Docs" });
    const docsId = docs.ok ? docs.boardId : "";
    await a.call<Created>("createTable", { boardId: docsId, name: "Drafts" });
    await a.call<Created>("createTable", { boardId: board.id, name: "Notes" });
    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () => expect((await projects(b)).map((project) => project.name)).toContain("Drafts"));

    expect(await a.call("deleteSection", { boardId: board.id })).toMatchObject({ ok: false });
    expect(await a.call("deleteSection", { boardId: docsId })).toEqual({ ok: true });
    const left = (await projects(a)).map((project) => project.name);
    expect(left).toContain("Notes");
    expect(left).not.toContain("Docs");
    expect(left).not.toContain("Drafts");

    await b.call("retryDatabase", { boardId: onB.id });
    await vi.waitFor(async () => expect((await projects(b)).map((project) => project.name)).not.toContain("Docs"));
    expect((await projects(b)).map((project) => project.name)).not.toContain("Drafts");
    expect((await projects(b)).map((project) => project.name)).toContain("Notes");
  });
});
