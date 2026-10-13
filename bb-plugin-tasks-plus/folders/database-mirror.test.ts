// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";
import plugin from "../server";

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
type Mirror = { ok: true; folder: string | null } | { ok: false; message: string };
type Rows = { projects: unknown[]; orphans: { mirrorFolder?: string }[] };

/** Two machines on the board DOC kept in one database; the first one mirrors it into a folder. */
async function mirroredBoard() {
  hrana.addDatabase("docs-me.turso.io", "owner-token");
  const a = await machine("Mac mini");
  await a.call("connectDatabase", { url: "libsql://docs-me.turso.io", token: "owner-token", name: "Docs", prefix: "DOC" });
  const board = (await boardByPrefix(a, "DOC"))!;
  const invite = await a.call<Invite>("databaseInvite", { boardId: board.id });
  const b = await machine("MacBook");
  await b.call("connectDatabase", { url: invite.ok ? invite.invite : "" });
  const onB = (await boardByPrefix(b, "DOC"))!;
  const dir = mkdtempSync(join(tmpdir(), "database-mirror-"));
  dirs.push(dir);
  return { a, b, board, onB, dir };
}

const read = (dir: string, name: string): string | null => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null);

describe("Mirror folder: a database board's records as files on disk", () => {
  it("brings an edit from another machine into the folder, takes a deleted record's file away and leaves other files", async () => {
    const { a, b, board, onB, dir } = await mirroredBoard();
    writeFileSync(join(dir, "notes.md"), "mine");
    const { task } = await b.call<{ task: { id: string } }>("createTask", { projectId: onB.id, title: "Contacts" });
    expect(await a.call<Mirror>("setMirrorFolder", { boardId: board.id, folder: dir })).toEqual({ ok: true, folder: dir });

    await a.call("retryDatabase", { boardId: board.id });
    await vi.waitFor(() => expect(read(dir, "DOC-1.md")).toContain("title: Contacts"));

    await b.call("updateTask", { taskId: task.id, description: "Phone: +7 900" });
    await a.call("retryDatabase", { boardId: board.id });
    await vi.waitFor(() => expect(read(dir, "DOC-1.md")).toContain("Phone: +7 900"));

    await b.call("deleteTask", { taskId: task.id });
    await a.call("retryDatabase", { boardId: board.id });
    await vi.waitFor(() => expect(read(dir, "DOC-1.md")).toBeNull());
    expect(readdirSync(dir).sort()).toEqual([".tasks-mirror.json", "notes.md"]);
  });

  it("brings an edit made on its own machine into the folder", async () => {
    const { a, board, dir } = await mirroredBoard();
    await a.call("setMirrorFolder", { boardId: board.id, folder: dir });
    const { task } = await a.call<{ task: { id: string } }>("createTask", { projectId: board.id, title: "Notes" });
    await vi.waitFor(() => expect(read(dir, "DOC-1.md")).toContain("title: Notes"));
    await a.call("updateTask", { taskId: task.id, description: "Written here" });
    await vi.waitFor(() => expect(read(dir, "DOC-1.md")).toContain("Written here"));
  });

  it("keeps the folder's files when the plugin loads again", async () => {
    const { a, board, dir } = await mirroredBoard();
    await a.call("setMirrorFolder", { boardId: board.id, folder: dir });
    await a.call("createTask", { projectId: board.id, title: "Notes" });
    await vi.waitFor(() => expect(read(dir, "DOC-1.md")).not.toBeNull());
    // The database does not answer while the plugin loads again: the mirror has nothing to go by, so it keeps the files.
    hrana.setOffline(true);
    const again = await a.harness.reload((bb) => plugin(bb));
    hosts.push(again as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(read(dir, "DOC-1.md")).toContain("title: Notes");
  });

  it("refuses a folder another board already mirrors into", async () => {
    const { a, board, dir } = await mirroredBoard();
    hrana.addDatabase("other-me.turso.io", "t2");
    await a.call("connectDatabase", { url: "libsql://other-me.turso.io", token: "t2", name: "Other", prefix: "OTH" });
    const other = (await boardByPrefix(a, "OTH"))!;
    await a.call("setMirrorFolder", { boardId: board.id, folder: dir });
    expect(await a.call<Mirror>("setMirrorFolder", { boardId: other.id, folder: dir })).toMatchObject({ ok: false, message: expect.stringMatching(/already mirrors/) });
  });

  it("is off for a blank folder and refuses a folder that is not a full path", async () => {
    const { a, board } = await mirroredBoard();
    expect(await a.call<Mirror>("setMirrorFolder", { boardId: board.id, folder: "docs" })).toMatchObject({ ok: false });
    expect(await a.call<Mirror>("setMirrorFolder", { boardId: board.id, folder: " " })).toEqual({ ok: true, folder: null });
  });

  it("is told in the row of the board", async () => {
    const { a, board, dir } = await mirroredBoard();
    await a.call("setMirrorFolder", { boardId: board.id, folder: dir });
    const rows = await a.call<Rows>("listProjectRows", null);
    expect(rows.orphans.find((row) => (row as { id?: string }).id === board.id)).toMatchObject({ mirrorFolder: dir });
  });
});
