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

async function machine() {
  const host = await tasksHost({ machine: "Mac mini" });
  hosts.push(host);
  return host;
}

const warnings = (host: TasksHost) =>
  (host.harness as unknown as { logEntries: { level: string; message: string }[] }).logEntries
    .filter((entry) => entry.level === "warn")
    .map((entry) => entry.message);

const TOKEN = "db-token-91c";

describe("Connect database on a database that cannot be reached", () => {
  it("names the cause in the message the dialog shows, and adds no board", async () => {
    const a = await machine();
    hrana.addDatabase("busy-me.turso.io", TOKEN);
    hrana.respondWith(503);
    const refused = await a.call<{ ok: false; error: { code: string; message: string } }>("connectDatabase", {
      url: "libsql://busy-me.turso.io",
      token: TOKEN,
      name: "Busy",
      prefix: "BSY",
    });
    expect(refused.error.code).toBe("database_unreachable");
    expect(refused.error.message).toContain("cannot be reached");
    expect(refused.error.message).toContain("HTTP 503");
    expect(await boardByPrefix(a, "BSY")).toBeUndefined();
  });

  it("names a dropped network in the message", async () => {
    const a = await machine();
    hrana.addDatabase("down-me.turso.io", TOKEN);
    hrana.setOffline(true);
    const refused = await a.call<{ error: { message: string } }>("connectDatabase", { url: "libsql://down-me.turso.io", token: TOKEN, name: "Down", prefix: "DWN" });
    expect(refused.error.message).toContain("fetch failed");
  });

  it("writes the cause and the address into the bb log, without the token", async () => {
    const a = await machine();
    hrana.addDatabase("busy-me.turso.io", TOKEN);
    hrana.respondWith(503);
    await a.call("connectDatabase", { url: `libsql://busy-me.turso.io?authToken=${TOKEN}`, name: "Busy", prefix: "BSY" });
    const lines = warnings(a).filter((line) => line.includes("libsql://busy-me.turso.io"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes("HTTP 503"))).toBe(true);
    expect(warnings(a).join("\n")).not.toContain(TOKEN);
  });

  it("writes the cause into the bb log when reading the board before connecting fails", async () => {
    const a = await machine();
    hrana.addDatabase("peek-me.turso.io", TOKEN);
    hrana.respondWith(502);
    expect(await a.call("inspectDatabase", { url: "libsql://peek-me.turso.io", token: TOKEN })).toMatchObject({
      ok: false,
      error: { code: "database_unreachable" },
    });
    expect(warnings(a).some((line) => line.includes("libsql://peek-me.turso.io") && line.includes("HTTP 502"))).toBe(true);
  });
});
