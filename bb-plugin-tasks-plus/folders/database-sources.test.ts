// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
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

async function machine(name: string) {
  const host = await tasksHost({ machine: name, settings: { tursoApiToken: turso.accountToken } });
  hosts.push(host);
  return host;
}

async function connected(host: TasksHost, url?: string) {
  const address = url ?? (await host.call<{ url: string }>("createDatabase", { prefix: "REM" })).url;
  expect(await host.call("connectDatabase", url ? { url } : { url: address, name: "Remote", prefix: "REM" })).toEqual({ ok: true });
  return { url: address, board: (await boardByPrefix(host, "REM"))! };
}

type Row = { projectId: string; taskCount: number; tasksFolder: string | null; repoPath: string | null; source: { kind: string; state?: string; lastSyncAt?: string | null; url?: string } };
const rowOf = async (host: TasksHost, boardId: string) =>
  (await host.call<{ folders: Row[] }>("listSyncedFolders")).folders.find((row) => row.projectId === boardId);

const signals = (host: TasksHost, channel: string) => host.harness.realtimeSignals.filter((signal) => signal.channel === channel).length;

describe("a database board in the list of connected sources", () => {
  it("is listed with its address, its task count and a live link, and no folder", async () => {
    const a = await machine("Mac mini");
    const { url, board } = await connected(a);
    await a.call("createTask", { projectId: board.id, title: "Glow" });
    const row = await rowOf(a, board.id);
    expect(row).toMatchObject({ taskCount: 1, tasksFolder: null, repoPath: null, source: { kind: "database", url, state: "live" } });
    expect(typeof row?.source.lastSyncAt).toBe("string");
    expect(JSON.stringify(row)).not.toContain("jwt-");
  });

  it("goes unreachable when the network drops, says so to the interface, and is live again after Retry", async () => {
    const a = await machine("Mac mini");
    const { board } = await connected(a);
    const before = signals(a, "projects:changed");
    hrana.setOffline(true);
    for (let attempt = 0; attempt < 3; attempt += 1) await a.call("retryDatabase", { boardId: board.id });
    expect((await rowOf(a, board.id))?.source).toMatchObject({ kind: "database", state: "offline" });
    expect(signals(a, "projects:changed")).toBeGreaterThan(before);
    hrana.setOffline(false);
    await a.call("retryDatabase", { boardId: board.id });
    expect((await rowOf(a, board.id))?.source).toMatchObject({ state: "live" });
  });

  it("tells the interface to reload tasks when another machine changed the board", async () => {
    const a = await machine("Mac mini");
    const b = await machine("MacBook");
    const { url, board } = await connected(a);
    const { board: onB } = await connected(b, url);
    const before = signals(a, "tasks:changed");
    await b.call("createTask", { projectId: onB.id, title: "From B" });
    await a.call("retryDatabase", { boardId: board.id });
    expect(signals(a, "tasks:changed")).toBeGreaterThan(before);
    const { tasks } = await a.call<{ tasks: { title: string }[] }>("listTasks", { projectId: board.id });
    expect(tasks.map((task) => task.title)).toEqual(["From B"]);
  });

  it("opens again after the plugin reloads, with the token it saved", async () => {
    const a = await machine("Mac mini");
    const { board } = await connected(a);
    await a.call("createTask", { projectId: board.id, title: "Survives a reload" });
    const reloaded = await a.harness.lifecycle.reload(plugin);
    const again = await vi.waitFor(
      async () => {
        const { tasks } = (await reloaded.harness.callRpc("listTasks", { projectId: board.id })) as { tasks: { title: string }[] };
        return tasks;
      },
      { timeout: 3000, interval: 50 },
    ).catch((error: unknown) => expect.fail(`the reloaded plugin cannot read the board: ${String(error)}`));
    expect(again.map((task) => task.title)).toEqual(["Survives a reload"]);
    await reloaded.harness.dispose();
  });
});
