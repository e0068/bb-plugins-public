// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createTursoFake, type TursoFakeOptions } from "../test-support/turso-fake.js";

const tursoPath = "./turso.js";
const { createTursoApi, databaseBaseName } = await planned<typeof import("./turso.js")>(() => import(/* @vite-ignore */ tursoPath));

function setup(options: TursoFakeOptions = {}) {
  const hrana = createHranaFake();
  const turso = createTursoFake(hrana, options);
  const api = createTursoApi({ token: turso.accountToken, fetch: turso.fetch });
  return { hrana, turso, api };
}

async function ok<T>(result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>): Promise<T> {
  const settled = await result;
  expect(settled, JSON.stringify(settled)).toMatchObject({ ok: true });
  return (settled as { ok: true; value: T }).value;
}

describe("creating a database in Turso without opening its console", () => {
  it("names a board's database after its prefix", () => {
    expect(databaseBaseName("TSK")).toBe("bb-tasks-tsk");
  });

  it("works in the personal organization", async () => {
    const { api } = setup();
    expect(await ok(api.organization())).toBe("me");
  });

  it("falls back to the first organization when there is no personal one", async () => {
    const { api } = setup({ organizations: [{ slug: "acme", type: "team" }] });
    expect(await ok(api.organization())).toBe("acme");
  });

  it("makes a default group in the nearest location when the organization has none", async () => {
    const { api, turso } = setup();
    expect(await ok(api.ensureGroup("me"))).toBe("default");
    expect(turso.groups()).toEqual(["default"]);
  });

  it("uses the group the organization already has", async () => {
    const { api, turso } = setup({ groups: ["main"] });
    expect(await ok(api.ensureGroup("me"))).toBe("main");
    expect(turso.calls().filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("creates the database and hands back its libsql address", async () => {
    const { api } = setup({ groups: ["default"] });
    expect(await ok(api.createDatabase("me", "bb-tasks-tsk", "default"))).toEqual({ name: "bb-tasks-tsk", url: "libsql://bb-tasks-tsk-me.turso.io" });
  });

  it("takes the next free suffix when the name is taken", async () => {
    const { api } = setup({ groups: ["default"], takenNames: ["bb-tasks-tsk", "bb-tasks-tsk-2"] });
    expect(await ok(api.createDatabase("me", "bb-tasks-tsk", "default"))).toMatchObject({ name: "bb-tasks-tsk-3" });
  });

  it("gives up with name_taken after the ninth suffix", async () => {
    const taken = ["bb-tasks-tsk", ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `bb-tasks-tsk-${n}`)];
    const { api } = setup({ groups: ["default"], takenNames: taken });
    expect(await api.createDatabase("me", "bb-tasks-tsk", "default")).toEqual({ ok: false, error: { kind: "name_taken" } });
  });

  it("lists the organization's databases by name and address", async () => {
    const { api } = setup({ groups: ["default"], takenNames: ["bb-tasks-web"] });
    expect(await ok(api.listDatabases("me"))).toEqual([{ name: "bb-tasks-web", url: "libsql://bb-tasks-web-me.turso.io" }]);
  });

  it("mints a token the new database accepts", async () => {
    const { api, turso } = setup({ groups: ["default"] });
    const { url, name } = await ok(api.createDatabase("me", "bb-tasks-tsk", "default"));
    const token = await ok(api.mintToken("me", name));
    const host = new URL(url.replace(/^libsql:/, "https:")).host;
    const response = await turso.fetch(`https://${host}/v2/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ baton: null, requests: [{ type: "execute", stmt: { sql: "SELECT 1" } }] }),
    });
    expect(response.status).toBe(200);
  });
});

describe("Turso failures are values", () => {
  it("a refused account token is an auth error that does not carry the token", async () => {
    const { turso } = setup();
    const api = createTursoApi({ token: "not-the-account-token", fetch: turso.fetch });
    const result = await api.organization();
    expect(result).toEqual({ ok: false, error: { kind: "auth" } });
    expect(JSON.stringify(result)).not.toContain("not-the-account-token");
  });

  it("a dropped network is the API being unreachable", async () => {
    const api = createTursoApi({ token: "t", fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect(await api.organization()).toEqual({ ok: false, error: { kind: "unreachable" } });
  });

  it("any other refusal is an api error with the text of the answer", async () => {
    const { api } = setup();
    const result = await api.createDatabase("me", "bb-tasks-tsk", "no-such-group");
    expect(result).toMatchObject({ ok: false, error: { kind: "api" } });
    expect((result as { error: { message: string } }).error.message).toContain("invalid database");
  });
});
