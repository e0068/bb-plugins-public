// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createTursoFake, type TursoFake } from "../test-support/turso-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";

let hrana: HranaFake;
let turso: TursoFake;
const hosts: TasksHost[] = [];
const dirs: string[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  turso = createTursoFake(hrana);
  vi.stubGlobal("fetch", turso.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function machine(name: string, settings?: Record<string, string>, bbProject?: { id: string; name: string; path: string }) {
  const host = await tasksHost({ machine: name, settings, bbProject });
  hosts.push(host);
  return host;
}

function noSecretsIn(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain("jwt-");
  expect(text).not.toContain(turso.accountToken);
}

async function createAndConnect(host: TasksHost, prefix = "REM", name = "Remote") {
  const created = await host.call<{ ok: boolean; url: string }>("createDatabase", { prefix, tursoApiToken: turso.accountToken });
  expect(created, JSON.stringify(created)).toMatchObject({ ok: true });
  const connected = await host.call("connectDatabase", { url: created.url, name, prefix });
  expect(connected).toEqual({ ok: true });
  return created.url;
}

describe("Create: a new database without leaving the dialog", () => {
  it("asks for a Turso token when none is saved", async () => {
    const a = await machine("Mac mini");
    expect(await a.call("createDatabase", { prefix: "REM" })).toMatchObject({ ok: false, error: { code: "turso_token_required" } });
  });

  it("makes the database, keeps both tokens secret, and answers the address only", async () => {
    const a = await machine("Mac mini");
    const created = await a.call("createDatabase", { prefix: "REM", tursoApiToken: turso.accountToken });
    expect(created).toEqual({ ok: true, url: "libsql://bb-tasks-rem-me.turso.io" });
    noSecretsIn(created);
    expect(await a.call("hasTursoApiToken")).toEqual({ saved: true });
  });

  it("uses the saved Turso token the second time without asking", async () => {
    const a = await machine("Mac mini", { tursoApiToken: turso.accountToken });
    expect(await a.call("createDatabase", { prefix: "WEB" })).toMatchObject({ ok: true, url: "libsql://bb-tasks-web-me.turso.io" });
  });
});

describe("Connect: a board kept in a database", () => {
  it("connects the created database as a new board named as asked, with no token typed", async () => {
    const a = await machine("Mac mini");
    const url = await createAndConnect(a);
    expect(await boardByPrefix(a, "REM")).toMatchObject({ name: "Remote", database: { url } });
  });

  it("lets a second machine pick the database from its account and take the board's name and prefix from it", async () => {
    const a = await machine("Mac mini");
    const url = await createAndConnect(a);
    const board = (await boardByPrefix(a, "REM"))!;
    await a.call("createTask", { projectId: board.id, title: "Glow" });
    const b = await machine("MacBook", { tursoApiToken: turso.accountToken });
    const listed = await b.call<{ ok: boolean; databases: { name: string; url: string }[] }>("listTursoDatabases");
    expect(listed.databases).toContainEqual({ name: "bb-tasks-rem", url });
    noSecretsIn(listed);
    expect(await b.call("connectDatabase", { url })).toEqual({ ok: true });
    const onB = (await boardByPrefix(b, "REM"))!;
    expect(onB.name).toBe("Remote");
    const { tasks } = await b.call<{ tasks: { title: string; key: string }[] }>("listTasks", { projectId: onB.id });
    expect(tasks.map((task) => [task.key, task.title])).toEqual([["REM-1", "Glow"]]);
  });

  it("takes the token out of an address with ?authToken=", async () => {
    const a = await machine("Mac mini");
    hrana.addDatabase("raw-me.turso.io", "raw-token");
    expect(await a.call("connectDatabase", { url: "libsql://raw-me.turso.io?authToken=raw-token", name: "Raw", prefix: "RAW" })).toEqual({ ok: true });
    expect(await boardByPrefix(a, "RAW")).toMatchObject({ database: { url: "libsql://raw-me.turso.io" } });
  });

  it("says the database is unreachable and adds no board when it cannot be reached", async () => {
    const a = await machine("Mac mini");
    hrana.addDatabase("down-me.turso.io", "t");
    hrana.setOffline(true);
    expect(await a.call("connectDatabase", { url: "libsql://down-me.turso.io", token: "t", name: "Down", prefix: "DWN" })).toMatchObject({
      ok: false,
      error: { code: "database_unreachable" },
    });
    expect(await boardByPrefix(a, "DWN")).toBeUndefined();
  });

  it("says the token was refused and adds no board", async () => {
    const a = await machine("Mac mini");
    hrana.addDatabase("locked-me.turso.io", "right");
    expect(await a.call("connectDatabase", { url: "libsql://locked-me.turso.io", token: "wrong", name: "Locked", prefix: "LCK" })).toMatchObject({
      ok: false,
      error: { code: "database_auth_failed" },
    });
    expect(await boardByPrefix(a, "LCK")).toBeUndefined();
  });
});

describe("Move tasks from a folder", () => {
  async function folderBoard() {
    const checkout = mkdtempSync(join(tmpdir(), "move-folder-"));
    dirs.push(checkout);
    const a = await machine("Mac mini", { tursoApiToken: turso.accountToken }, { id: "proj_x", name: "Repo", path: checkout });
    const added = await a.call<{ ok: boolean; folder: { projectId: string; projectPrefix: string } }>("addSyncedFolder", { bbProjectId: "proj_x", tasksFolder: "docs/tasks" });
    expect(added.ok).toBe(true);
    const boardId = added.folder.projectId;
    const make = async (title: string, status: string) =>
      (await a.call<{ ok: boolean; task: { id: string; key: string } }>("createTask", { projectId: boardId, title, status })).task;
    const first = await make("Glow", "in_review");
    await make("Dust", "todo");
    await a.call("createComment", { taskId: first.id, body: "Looks right.", notify: false });
    const snapshot = () => readdirSync(join(checkout, "docs/tasks"), { recursive: true }).map(String).sort().map((path) => [path, path.endsWith(".md") ? readFileSync(join(checkout, "docs/tasks", path), "utf8") : ""]);
    return { a, boardId, prefix: added.folder.projectPrefix, first, snapshot, checkout };
  }

  const tasksOf = async (host: TasksHost, boardId: string) =>
    (await host.call<{ tasks: { key: string; status: string; title: string }[] }>("listTasks", { projectId: boardId })).tasks.map((task) => [task.key, task.status, task.title]).sort();

  it("turns the folder board into a database board in place: same id, keys, statuses and comments", async () => {
    const { a, boardId, prefix, first, snapshot } = await folderBoard();
    const before = await tasksOf(a, boardId);
    const files = snapshot();
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    expect(await a.call("connectDatabase", { url: created.url, moveFromBoardId: boardId })).toEqual({ ok: true });
    const board = (await a.call<{ projects: { id: string; database?: { url: string } | null }[] }>("listProjects", {})).projects.find((p) => p.id === boardId);
    expect(board?.database).toEqual({ url: created.url });
    expect(await tasksOf(a, boardId)).toEqual(before);
    const { comments } = await a.call<{ comments: { body: string }[] }>("listComments", { taskId: first.id });
    expect(comments.map((comment) => comment.body)).toContain("Looks right.");
    expect(snapshot()).toEqual(files);
    const next = await a.call<{ task: { key: string } }>("createTask", { projectId: boardId, title: "After the move" });
    expect(next.task.key).toBe(`${prefix}-3`);
  });

  it("refuses to move a folder where two tasks share a key, naming the key, and leaves the board a folder", async () => {
    const { a, boardId, prefix, first, checkout } = await folderBoard();
    const inReview = join(checkout, "docs/tasks/in_review");
    const [file] = readdirSync(inReview);
    writeFileSync(join(inReview, "twin.md"), readFileSync(join(inReview, String(file)), "utf8"));
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    const result = await a.call<{ ok: boolean; error?: { message: string } }>("connectDatabase", { url: created.url, moveFromBoardId: boardId });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain(first.key);
    const board = (await a.call<{ projects: { id: string; database: { url: string } | null }[] }>("listProjects", {})).projects.find((p) => p.id === boardId);
    expect(board?.database ?? null).toBeNull();
  });

  it("keeps when each task was created and last changed", async () => {
    const { a, boardId, prefix } = await folderBoard();
    const times = async () =>
      (await a.call<{ tasks: { key: string; createdAt: string; updatedAt: string }[] }>("listTasks", { projectId: boardId })).tasks
        .map((task) => [task.key, task.createdAt, task.updatedAt])
        .sort();
    const before = await times();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    expect(await a.call("connectDatabase", { url: created.url, moveFromBoardId: boardId })).toEqual({ ok: true });
    expect(await times()).toEqual(before);
  });

  it("keeps the board linked to its bb project: bb tasks create without --project lands on the moved board", async () => {
    const { a, boardId, prefix } = await folderBoard();
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    expect(await a.call("connectDatabase", { url: created.url, moveFromBoardId: boardId })).toEqual({ ok: true });
    const output = await a.harness.runCli(["create", "--title", "From the CLI", "--json"], { projectId: "proj_x" });
    expect(JSON.parse(String((output as { stdout?: string }).stdout ?? output)).task.key).toBe(`${prefix}-3`);
    expect(await a.call("addSyncedFolder", { bbProjectId: "proj_x", tasksFolder: "docs/tasks" })).toMatchObject({
      ok: false,
      error: { code: "folder_already_connected" },
    });
  });

  it("refuses to move into a database that already holds a board, and leaves the folder board as it was", async () => {
    const { a, boardId } = await folderBoard();
    const url = await createAndConnect(a, "OTH", "Other");
    expect(await a.call("connectDatabase", { url, moveFromBoardId: boardId })).toMatchObject({ ok: false, error: { code: "database_not_empty" } });
    const board = (await a.call<{ projects: { id: string; database?: unknown }[] }>("listProjects", {})).projects.find((p) => p.id === boardId);
    expect(board?.database ?? null).toBeNull();
  });
});
