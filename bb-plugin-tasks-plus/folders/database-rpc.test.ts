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

describe("Create: a saved Turso token the account no longer accepts", () => {
  it("is refused with its own code, so the dialog can ask for a new token", async () => {
    const a = await machine("Mac mini", { tursoApiToken: "revoked-token" });
    expect(await a.call("createDatabase", { prefix: "REM" })).toMatchObject({ ok: false, error: { code: "turso_token_refused" } });
  });

  it("gives way to a new token Turso accepts: the next Create needs no token typed", async () => {
    const a = await machine("Mac mini", { tursoApiToken: "revoked-token" });
    expect(await a.call("createDatabase", { prefix: "REM", tursoApiToken: turso.accountToken })).toMatchObject({ ok: true });
    expect(await a.call("createDatabase", { prefix: "WEB" })).toMatchObject({ ok: true, url: "libsql://bb-tasks-web-me.turso.io" });
  });
});

describe("A refused Turso token: which one, and Connect taking a new one", () => {
  it("names the saved token when the saved one is refused", async () => {
    const a = await machine("Mac mini", { tursoApiToken: "revoked-token" });
    const refused = await a.call<{ error: { message: string } }>("createDatabase", { prefix: "REM" });
    expect(refused.error.message).toMatch(/saved/);
  });

  it("does not blame the saved token when the typed one is refused", async () => {
    const a = await machine("Mac mini");
    const refused = await a.call<{ error: { code: string; message: string } }>("createDatabase", { prefix: "REM", tursoApiToken: "wrong-token" });
    expect(refused.error.code).toBe("turso_token_refused");
    expect(refused.error.message).not.toMatch(/saved/);
  });

  it("Connect takes a typed account token in place of the refused saved one, and keeps it", async () => {
    const a = await machine("Mac mini");
    const created = await a.call<{ url: string }>("createDatabase", { prefix: "REM", tursoApiToken: turso.accountToken });
    const b = await machine("MacBook", { tursoApiToken: "revoked-token" });
    expect(await b.call("connectDatabase", { url: created.url, name: "Remote", prefix: "REM" })).toMatchObject({
      ok: false,
      error: { code: "turso_token_refused" },
    });
    expect(await b.call("connectDatabase", { url: created.url, name: "Remote", prefix: "REM", tursoApiToken: turso.accountToken })).toEqual({ ok: true });
    expect(await b.call("listTursoDatabases")).toMatchObject({ ok: true });
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

describe("Create: a database before its board has a prefix", () => {
  it("names the database after no prefix when none is given yet", async () => {
    const a = await machine("Mac mini", { tursoApiToken: turso.accountToken });
    expect(await a.call("createDatabase", {})).toEqual({ ok: true, url: "libsql://bb-tasks-board-me.turso.io" });
  });
});

describe("Inspect: what a database holds, before connecting it", () => {
  it("names the board a database already holds", async () => {
    const a = await machine("Mac mini");
    const url = await createAndConnect(a);
    const b = await machine("MacBook", { tursoApiToken: turso.accountToken });
    const inspected = await b.call("inspectDatabase", { url });
    expect(inspected).toEqual({ ok: true, board: { name: "Remote", prefix: "REM" } });
    noSecretsIn(inspected);
  });

  it("finds no board in a database just created", async () => {
    const a = await machine("Mac mini", { tursoApiToken: turso.accountToken });
    const created = await a.call<{ url: string }>("createDatabase", { prefix: "REM" });
    expect(await a.call("inspectDatabase", { url: created.url })).toEqual({ ok: true, board: null });
  });

  it("says the token was refused rather than calling the database empty", async () => {
    const a = await machine("Mac mini");
    hrana.addDatabase("locked-me.turso.io", "right");
    expect(await a.call("inspectDatabase", { url: "libsql://locked-me.turso.io", token: "wrong" })).toMatchObject({
      ok: false,
      error: { code: "database_auth_failed" },
    });
  });
});

describe("Copy tasks from a folder", () => {
  async function folderBoard() {
    const checkout = mkdtempSync(join(tmpdir(), "copy-folder-"));
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

  type Board = { id: string; name: string; prefix: string; tasksFolder: string | null; database?: { url: string } | null };
  const boards = async (host: TasksHost) => (await host.call<{ projects: Board[] }>("listProjects", {})).projects;

  it("leaves the folder board as it was and adds a database board beside it with the same keys, statuses and comments", async () => {
    const { a, boardId, prefix, snapshot } = await folderBoard();
    const before = await tasksOf(a, boardId);
    const files = snapshot();
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    expect(await a.call("connectDatabase", { url: created.url, copyFromBoardId: boardId })).toEqual({ ok: true });
    const all = await boards(a);
    const folder = all.find((board) => board.id === boardId);
    expect(folder).toMatchObject({ tasksFolder: "docs/tasks" });
    expect(folder?.database ?? null).toBeNull();
    expect(await tasksOf(a, boardId)).toEqual(before);
    expect(snapshot()).toEqual(files);
    const copy = all.find((board) => board.database?.url === created.url);
    expect(copy).toMatchObject({ name: folder?.name, prefix });
    expect(copy?.id).not.toBe(boardId);
    expect(await tasksOf(a, copy!.id)).toEqual(before);
    const glow = (await a.call<{ tasks: { id: string; title: string }[] }>("listTasks", { projectId: copy!.id })).tasks.find((task) => task.title === "Glow");
    const { comments } = await a.call<{ comments: { body: string }[] }>("listComments", { taskId: glow!.id });
    expect(comments.map((comment) => comment.body)).toContain("Looks right.");
  });

  it("lists both boards in Folders: the folder row and the database row", async () => {
    const { a, boardId, prefix } = await folderBoard();
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    expect(await a.call("connectDatabase", { url: created.url, copyFromBoardId: boardId })).toEqual({ ok: true });
    const { folders } = await a.call<{ folders: { projectId: string; source: { kind: string } }[] }>("listSyncedFolders");
    expect(folders.find((row) => row.projectId === boardId)?.source.kind).toBe("folder");
    expect(folders.filter((row) => row.source.kind === "database")).toHaveLength(1);
  });

  it("keeps on the copy when each task was created and last changed", async () => {
    const { a, boardId, prefix } = await folderBoard();
    const times = async (id: string) =>
      (await a.call<{ tasks: { key: string; createdAt: string; updatedAt: string }[] }>("listTasks", { projectId: id })).tasks
        .map((task) => [task.key, task.createdAt, task.updatedAt])
        .sort();
    const before = await times(boardId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    expect(await a.call("connectDatabase", { url: created.url, copyFromBoardId: boardId })).toEqual({ ok: true });
    const copy = (await boards(a)).find((board) => board.database?.url === created.url)!;
    expect(await times(copy.id)).toEqual(before);
  });

  it("refuses to copy a folder where two tasks share a key, naming the key, and adds no board", async () => {
    const { a, boardId, prefix, first, checkout } = await folderBoard();
    const inReview = join(checkout, "docs/tasks/in_review");
    const [file] = readdirSync(inReview);
    writeFileSync(join(inReview, "twin.md"), readFileSync(join(inReview, String(file)), "utf8"));
    const created = await a.call<{ url: string }>("createDatabase", { prefix });
    const result = await a.call<{ ok: boolean; error?: { message: string } }>("connectDatabase", { url: created.url, copyFromBoardId: boardId });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain(first.key);
    expect((await boards(a)).some((board) => board.database?.url === created.url)).toBe(false);
  });

  it("refuses to copy into a database that already holds a board, and adds no board", async () => {
    const { a, boardId } = await folderBoard();
    const url = await createAndConnect(a, "OTH", "Other");
    const count = (await boards(a)).length;
    expect(await a.call("connectDatabase", { url, copyFromBoardId: boardId })).toMatchObject({ ok: false, error: { code: "database_not_empty" } });
    expect(await boards(a)).toHaveLength(count);
  });
});

describe("Inspect: which tokens it keeps", () => {
  it("keeps a token Turso minted for the reading, so connecting needs no new one", async () => {
    const a = await machine("Mac mini");
    const url = await createAndConnect(a);
    const b = await machine("MacBook", { tursoApiToken: turso.accountToken });
    expect(await b.call("inspectDatabase", { url })).toMatchObject({ ok: true });
    vi.stubGlobal("fetch", hrana.fetch); // Turso no longer answers: only a kept token opens the database
    expect(await b.call("inspectDatabase", { url })).toEqual({ ok: true, board: { name: "Remote", prefix: "REM" } });
  });

  it("keeps no token the person typed: an abandoned address leaves nothing behind", async () => {
    const a = await machine("Mac mini");
    hrana.addDatabase("own-me.turso.io", "own-token");
    expect(await a.call("inspectDatabase", { url: "libsql://own-me.turso.io", token: "own-token" })).toEqual({ ok: true, board: null });
    expect(await a.call("inspectDatabase", { url: "libsql://own-me.turso.io" })).toMatchObject({ ok: false });
  });
});
