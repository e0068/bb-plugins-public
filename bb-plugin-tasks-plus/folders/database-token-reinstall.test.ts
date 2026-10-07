// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { createTursoFake } from "../test-support/turso-fake.js";
import { boardByPrefix, tasksHost } from "../test-support/tasks-host.js";
import { TOKENS_KV_KEY } from "./database-secrets.js";

let hrana: HranaFake;
const disposers: Array<() => Promise<void>> = [];

beforeEach(() => {
  hrana = createHranaFake();
  vi.stubGlobal("fetch", createTursoFake(hrana).fetch);
});
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  vi.unstubAllGlobals();
});

const HOST = "kept-me.turso.io";
const URL = `libsql://${HOST}`;
const TOKEN = "db-token-kept";

type Harness = Awaited<ReturnType<typeof tasksHost>>["harness"];
type Row = { projectId: string; source: { kind: string; state?: string } };

/** A machine with a database board holding one task. */
async function connected() {
  const host = await tasksHost({ machine: "Mac mini" });
  hrana.addDatabase(HOST, TOKEN);
  expect(await host.call("connectDatabase", { url: URL, token: TOKEN, name: "Remote", prefix: "REM" })).toEqual({ ok: true });
  const board = (await boardByPrefix(host, "REM"))!;
  await host.call("createTask", { projectId: board.id, title: "Glow" });
  return { host, board };
}

/** What bb does to a plugin it removes and installs again: its settings and secrets are gone, its kv stays. */
async function reinstalled(harness: Harness): Promise<Harness> {
  await harness.setSettings({ tursoApiToken: null, databaseTokens: null });
  const next = await harness.reload((bb) => plugin(bb));
  disposers.push(() => next.harness.dispose());
  return next.harness;
}

const call = <T>(harness: Harness, method: string, input: unknown = null) => harness.callRpc(method, input) as Promise<T>;

async function stateOf(harness: Harness, boardId: string) {
  await call(harness, "retryDatabase", { boardId });
  return (await call<{ folders: Row[] }>(harness, "listSyncedFolders")).folders.find((row) => row.projectId === boardId)?.source.state;
}

const titles = async (harness: Harness, boardId: string) =>
  (await call<{ tasks: { title: string }[] }>(harness, "listTasks", { projectId: boardId })).tasks.map((task) => task.title);

describe("a database board's token across a reinstall of the plugin", () => {
  it("stays with the board: after bb wipes the plugin's secrets the board is live with its tasks", async () => {
    const { host, board } = await connected();

    const after = await reinstalled(host.harness);

    expect(await stateOf(after, board.id)).toBe("live");
    expect(await titles(after, board.id)).toEqual(["Glow"]);
  });

  it("moves a token an older version kept in the secret settings to the board, so the next reinstall keeps it", async () => {
    const { host, board } = await connected();
    await host.bb.storage.kv.set(TOKENS_KV_KEY, null);
    await host.harness.setSettings({ databaseTokens: JSON.stringify({ [URL]: TOKEN }) });
    const upgraded = await host.harness.reload((bb) => plugin(bb));
    disposers.push(() => upgraded.harness.dispose());
    expect(await stateOf(upgraded.harness, board.id)).toBe("live");

    const after = await reinstalled(upgraded.harness);

    expect(await stateOf(after, board.id)).toBe("live");
    expect(await titles(after, board.id)).toEqual(["Glow"]);
  });

  it("does not bring back from the secret settings a token forgotten after the move", async () => {
    const { host, board } = await connected();
    await host.bb.storage.kv.set(TOKENS_KV_KEY, null);
    await host.harness.setSettings({ databaseTokens: JSON.stringify({ [URL]: TOKEN }) });
    const upgraded = await host.harness.reload((bb) => plugin(bb));
    disposers.push(() => upgraded.harness.dispose());
    expect(await stateOf(upgraded.harness, board.id)).toBe("live");
    await call(upgraded.harness, "removeSyncedFolder", { projectId: board.id });

    const after = await upgraded.harness.reload((bb) => plugin(bb));
    disposers.push(() => after.harness.dispose());
    await call(after.harness, "hasTursoApiToken");

    expect(await after.bb.storage.kv.get(TOKENS_KV_KEY)).toEqual({ tursoApiToken: null, databases: {} });
  });
});

describe("a database board with no token saved on this machine", () => {
  async function tokenless() {
    const { host, board } = await connected();
    await host.bb.storage.kv.set(TOKENS_KV_KEY, null);
    return { harness: await reinstalled(host.harness), board };
  }

  it("says there is no token, not that the database refused one", async () => {
    const { harness, board } = await tokenless();

    expect(await stateOf(harness, board.id)).toBe("no-token");
  });

  it("fails a read of its tasks with no token named, not with the database's refusal", async () => {
    const { harness, board } = await tokenless();

    await expect(call(harness, "listTasks", { projectId: board.id })).rejects.toThrow("no token for the database is saved on this machine");
  });
});
