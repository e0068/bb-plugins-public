// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createTursoFake, type TursoFake } from "../test-support/turso-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";

/**
 * The whole path, as the owner will use it: two machines, one database
 * board, the agent's CLI on each, and nothing carried by git.
 */

let turso: TursoFake;
const hosts: TasksHost[] = [];

beforeEach(() => {
  turso = createTursoFake(createHranaFake());
  vi.stubGlobal("fetch", turso.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.unstubAllGlobals();
});

async function twoMachines() {
  const mini = await tasksHost({ machine: "Mac mini", settings: { tursoApiToken: turso.accountToken } });
  const book = await tasksHost({ machine: "MacBook", settings: { tursoApiToken: turso.accountToken } });
  hosts.push(mini, book);
  const { url } = await mini.call<{ url: string }>("createDatabase", { prefix: "REM" });
  expect(await mini.call("connectDatabase", { url, name: "Remote", prefix: "REM" })).toEqual({ ok: true });
  expect(await book.call("connectDatabase", { url })).toEqual({ ok: true });
  return { mini, book, boardOnBook: (await boardByPrefix(book, "REM"))! };
}

function ok(result: { exitCode: number; stdout: string; stderr: string }): string {
  expect(result, result.stderr).toMatchObject({ exitCode: 0 });
  return result.stdout;
}

/** Polling, not a manual retry: what the other machine sees within the five seconds the task promises. */
async function within5s<T>(read: () => Promise<T>, check: (value: T) => void): Promise<void> {
  await vi.waitFor(async () => check(await read()), { timeout: 5000, interval: 100 });
}

describe("one board in a database, two machines", () => {
  it("a task created by the CLI on one machine is listed by the CLI on the other within seconds", async () => {
    const { mini, book } = await twoMachines();
    ok(await mini.harness.runCli(["create", "--project", "REM", "--title", "Glow", "--type", "feature", "--estimate", "s"]));
    await within5s(
      async () => JSON.parse(ok(await book.harness.runCli(["list", "--project", "REM", "--json"]))).tasks as { key: string }[],
      (tasks) => expect(tasks.map((task) => task.key)).toEqual(["REM-1"]),
    );
  });

  it("a comment and an update from one machine reach the other", async () => {
    const { mini, book } = await twoMachines();
    ok(await mini.harness.runCli(["create", "--project", "REM", "--title", "Glow", "--type", "feature", "--estimate", "s"]));
    await within5s(async () => book.harness.runCli(["show", "REM-1", "--json"]), (result) => expect(result.exitCode).toBe(0));
    ok(await book.harness.runCli(["comment", "REM-1", "--body", "Picked the palette."]));
    ok(await book.harness.runCli(["update", "REM-1", "--priority", "high"]));
    await within5s(
      async () => JSON.parse(ok(await mini.harness.runCli(["show", "REM-1", "--json"]))),
      (shown) => {
        expect(shown.task.priority).toBe("high");
        expect(JSON.stringify(shown)).toContain("Picked the palette.");
      },
    );
  });

  it("a task taken on one machine shows as taken on the other within five seconds, and the other is refused with the machine's name", async () => {
    const { mini, book, boardOnBook } = await twoMachines();
    ok(await mini.harness.runCli(["create", "--project", "REM", "--title", "Glow", "--type", "feature", "--estimate", "s"]));
    await within5s(async () => book.harness.runCli(["show", "REM-1", "--json"]), (result) => expect(result.exitCode).toBe(0));
    ok(await mini.harness.runCli(["update", "REM-1", "--status", "in_progress"]));
    await within5s(
      async () => (await book.call<{ tasks: { key: string; takenBy?: { machine: string } | null }[] }>("listTasks", { projectId: boardOnBook.id })).tasks,
      (tasks) => expect(tasks.find((task) => task.key === "REM-1")?.takenBy?.machine).toBe("Mac mini"),
    );
    const refused = await book.harness.runCli(["update", "REM-1", "--status", "in_progress"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatch(/REM-1 is already taken on Mac mini/);
  });
});
