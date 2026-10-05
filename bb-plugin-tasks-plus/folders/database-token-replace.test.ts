// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createTursoFake, type TursoFake } from "../test-support/turso-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";

let hrana: HranaFake;
let turso: TursoFake;
const hosts: TasksHost[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  turso = createTursoFake(hrana);
  vi.stubGlobal("fetch", turso.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.unstubAllGlobals();
});

const HOST = "rotated-me.turso.io";
const URL = `libsql://${HOST}`;
const OLD = "db-token-old";
const NEW = "db-token-new";

type Row = { projectId: string; source: { kind: string; state?: string } };
const stateOf = async (host: TasksHost, boardId: string) =>
  (await host.call<{ folders: Row[] }>("listSyncedFolders")).folders.find((row) => row.projectId === boardId)?.source.state;

/** A machine with a database board holding one task, whose token the database has since stopped accepting. */
async function machine(settings?: Record<string, string>) {
  const host = await tasksHost({ machine: "Mac mini", ...(settings ? { settings } : {}) });
  hosts.push(host);
  return host;
}

/** The token a host keeps for the board — it leaves the host only in an invite. */
async function savedToken(host: TasksHost, boardId: string) {
  const { invite } = await host.call<{ invite: string }>("databaseInvite", { boardId });
  return new globalThis.URL(invite).searchParams.get("authToken");
}

async function revoked() {
  const host = await machine();
  hrana.addDatabase(HOST, OLD);
  expect(await host.call("connectDatabase", { url: URL, token: OLD, name: "Remote", prefix: "REM" })).toEqual({ ok: true });
  const board = (await boardByPrefix(host, "REM"))!;
  await host.call("createTask", { projectId: board.id, title: "Glow" });
  hrana.revokeToken(HOST, OLD);
  hrana.allowToken(HOST, NEW);
  await host.call("retryDatabase", { boardId: board.id });
  return { host, board };
}

describe("a database board whose token was revoked", () => {
  it("says the token is refused, not that the link is live", async () => {
    const { host, board } = await revoked();

    expect(await stateOf(host, board.id)).toBe("refused");
  });

  it("takes a new token through Connect database on its own address, and comes back the same board with its tasks", async () => {
    const { host, board } = await revoked();

    expect(await host.call("connectDatabase", { url: URL, token: NEW })).toEqual({ ok: true });

    expect((await boardByPrefix(host, "REM"))?.id).toBe(board.id);
    expect(await stateOf(host, board.id)).toBe("live");
    const { tasks } = await host.call<{ tasks: { title: string }[] }>("listTasks", { projectId: board.id });
    expect(tasks.map((task) => task.title)).toEqual(["Glow"]);
  });

  it("keeps the board as it was when the token typed is refused too", async () => {
    const { host, board } = await revoked();

    expect(await host.call("connectDatabase", { url: URL, token: "db-token-wrong" })).toMatchObject({ ok: false, error: { code: "database_auth_failed" } });

    expect((await boardByPrefix(host, "REM"))?.id).toBe(board.id);
    expect(await stateOf(host, board.id)).toBe("refused");
  });
});

describe("a new token for a revoked board, from either side", () => {
  it("shows what another machine wrote meanwhile, and keeps the new token", async () => {
    const { host, board } = await revoked();
    const other = await machine();
    expect(await other.call("connectDatabase", { url: URL, token: NEW })).toEqual({ ok: true });
    await other.call("createTask", { projectId: (await boardByPrefix(other, "REM"))!.id, title: "Written meanwhile" });

    expect(await host.call("connectDatabase", { url: URL, token: NEW })).toEqual({ ok: true });

    const { tasks } = await host.call<{ tasks: { title: string }[] }>("listTasks", { projectId: board.id });
    expect(tasks.map((task) => task.title).sort()).toEqual(["Glow", "Written meanwhile"]);
    expect(await savedToken(host, board.id)).toBe(NEW);
  });

  it("mints a new token through the Turso account instead of retrying the refused one", async () => {
    const host = await machine({ tursoApiToken: turso.accountToken });
    const { url } = await host.call<{ url: string }>("createDatabase", { prefix: "ACC" });
    expect(await host.call("connectDatabase", { url, name: "Account", prefix: "ACC" })).toEqual({ ok: true });
    const board = (await boardByPrefix(host, "ACC"))!;
    const first = (await savedToken(host, board.id))!;
    hrana.revokeToken(new globalThis.URL(url).host, first);
    await host.call("retryDatabase", { boardId: board.id });
    expect(await stateOf(host, board.id)).toBe("refused");

    expect(await host.call("connectDatabase", { url })).toEqual({ ok: true });

    expect(await stateOf(host, board.id)).toBe("live");
    expect(await savedToken(host, board.id)).not.toBe(first);
  });
});
