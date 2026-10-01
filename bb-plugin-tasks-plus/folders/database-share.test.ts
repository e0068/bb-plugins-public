// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";

let hrana: HranaFake;
const hosts: TasksHost[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  vi.stubGlobal("fetch", hrana.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.unstubAllGlobals();
});

async function machine(name: string) {
  const host = await tasksHost({ machine: name });
  hosts.push(host);
  return host;
}

type Invite = { ok: true; invite: string } | { ok: false; error: { code: string; message: string } };
type Tasks = { tasks: { key: string; title: string }[] };

/** A machine with the board REM kept in the database at board-me.turso.io, holding one task. */
async function sharedBoard() {
  hrana.addDatabase("board-me.turso.io", "owner-token");
  const a = await machine("Mac mini");
  expect(await a.call("connectDatabase", { url: "libsql://board-me.turso.io", token: "owner-token", name: "Remote", prefix: "REM" })).toEqual({ ok: true });
  const board = (await boardByPrefix(a, "REM"))!;
  await a.call("createTask", { projectId: board.id, title: "Glow" });
  return { a, board };
}

describe("Share: an invite to a database board", () => {
  it("connects another machine to the same board with nothing else typed", async () => {
    const { a, board } = await sharedBoard();
    const invite = await a.call<Invite>("databaseInvite", { boardId: board.id });
    expect(invite.ok).toBe(true);
    const b = await machine("MacBook");
    expect(await b.call("connectDatabase", { url: invite.ok ? invite.invite : "" })).toEqual({ ok: true });
    const onB = (await boardByPrefix(b, "REM"))!;
    const { tasks } = await b.call<Tasks>("listTasks", { projectId: onB.id });
    expect(tasks.map((task) => [task.key, task.title])).toEqual([["REM-1", "Glow"]]);
  });

  it("is refused for a board that is not kept in a database", async () => {
    const a = await machine("Mac mini");
    const { project } = await a.call<{ project: { id: string } }>("createProject", { name: "Local", prefix: "LOC", color: "#888888" });
    expect(await a.call<Invite>("databaseInvite", { boardId: project.id })).toMatchObject({ ok: false });
  });
});

describe("Disconnect: a database board leaves this machine only", () => {
  it("drops the board and its token here, and the database keeps serving another machine", async () => {
    const { a, board } = await sharedBoard();
    const invite = await a.call<Invite>("databaseInvite", { boardId: board.id });
    const b = await machine("MacBook");
    await b.call("connectDatabase", { url: invite.ok ? invite.invite : "" });

    expect(await a.call("removeSyncedFolder", { projectId: board.id })).toEqual({ ok: true });

    expect(await boardByPrefix(a, "REM")).toBeUndefined();
    const { folders } = await a.call<{ folders: unknown[] }>("listSyncedFolders");
    expect(folders).toEqual([]);
    // No token is left behind: the bare address no longer connects on its own.
    expect(await a.call("connectDatabase", { url: "libsql://board-me.turso.io" })).toMatchObject({ ok: false, error: { code: "turso_token_required" } });
    const onB = (await boardByPrefix(b, "REM"))!;
    const { tasks } = await b.call<Tasks>("listTasks", { projectId: onB.id });
    expect(tasks.map((task) => task.title)).toEqual(["Glow"]);
  });

  it("connects again from the same address once a token is given", async () => {
    const { a, board } = await sharedBoard();
    await a.call("removeSyncedFolder", { projectId: board.id });
    expect(await a.call("connectDatabase", { url: "libsql://board-me.turso.io?authToken=owner-token" })).toEqual({ ok: true });
    expect(await boardByPrefix(a, "REM")).toMatchObject({ name: "Remote" });
  });
});
