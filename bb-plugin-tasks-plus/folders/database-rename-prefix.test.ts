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

type Tasks = { tasks: { key: string; title: string }[] };

/** The board REM in one database, open on two machines, holding one task. */
async function sharedBoard() {
  hrana.addDatabase("board-me.turso.io", "owner-token");
  const mini = await machine("Mac mini");
  await mini.call("connectDatabase", { url: "libsql://board-me.turso.io", token: "owner-token", name: "Remote", prefix: "REM" });
  const onMini = (await boardByPrefix(mini, "REM"))!;
  await mini.call("createTask", { projectId: onMini.id, title: "Glow" });
  const book = await machine("MacBook");
  await book.call("connectDatabase", { url: "libsql://board-me.turso.io?authToken=owner-token" });
  return { mini, book, onMini };
}

describe("a database board's new prefix reaches every machine", () => {
  it("renames the task keys in the database and the other machine takes the new prefix within seconds", async () => {
    const { mini, book, onMini } = await sharedBoard();

    expect(await mini.call("renameProjectPrefix", { projectId: onMini.id, prefix: "RX" })).toMatchObject({ ok: true, project: { prefix: "RX" } });

    await vi.waitFor(async () => expect(await boardByPrefix(book, "RX")).toMatchObject({ name: "Remote" }), { timeout: 5000, interval: 100 });
    const onBook = (await boardByPrefix(book, "RX"))!;
    const { tasks } = await book.call<Tasks>("listTasks", { projectId: onBook.id });
    expect(tasks.map((task) => [task.key, task.title])).toEqual([["RX-1", "Glow"]]);
  });

  it("keeps the old prefix on a machine where another board already has the new one", async () => {
    const { mini, book, onMini } = await sharedBoard();
    await book.call("createProject", { name: "Rex", prefix: "RX", color: "#888888" });

    await mini.call("renameProjectPrefix", { projectId: onMini.id, prefix: "RX" });

    await vi.waitFor(async () => expect((await book.call<Tasks>("listTasks", {})).tasks.map((task) => task.key)).toContain("RX-1"), { timeout: 5000, interval: 100 });
    expect(await boardByPrefix(book, "REM")).toMatchObject({ name: "Remote" });
  });

  it("keeps the database's board name while the prefix changes", async () => {
    const { mini, onMini } = await sharedBoard();
    await mini.call("updateProject", { projectId: onMini.id, name: "Local name" });

    await mini.call("renameProjectPrefix", { projectId: onMini.id, prefix: "RX" });

    const third = await machine("iMac");
    await third.call("connectDatabase", { url: "libsql://board-me.turso.io?authToken=owner-token" });
    expect(await boardByPrefix(third, "RX")).toMatchObject({ name: "Remote" });
  });
});
