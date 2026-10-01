// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHranaFake } from "./hrana-fake.js";
import { createTursoFake } from "./turso-fake.js";

/** The fakes are test infrastructure of the plan: this proves they speak the protocol the subtasks are written against. */

const HOST = "board-me.turso.io";

async function pipeline(fetcher: typeof fetch, token: string, requests: unknown[]) {
  const response = await fetcher(`https://${HOST}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ baton: null, requests }),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() : await response.text() };
}

const stmt = (sql: string, args: unknown[] = []) => ({ sql, args });

describe("the Hrana fake", () => {
  it("runs SQL, returns integers as strings, and answers constraint failures with extended codes", async () => {
    const fake = createHranaFake();
    fake.addDatabase(HOST, "t1");
    const { body } = await pipeline(fake.fetch, "t1", [
      { type: "execute", stmt: stmt("CREATE TABLE t (slug TEXT PRIMARY KEY, key TEXT UNIQUE, n INTEGER NOT NULL)") },
      { type: "execute", stmt: stmt("INSERT INTO t VALUES (?, ?, ?)", [{ type: "text", value: "a" }, { type: "text", value: "K-1" }, { type: "integer", value: "7" }]) },
      { type: "execute", stmt: stmt("INSERT INTO t VALUES ('b', 'K-1', 1)") },
      { type: "execute", stmt: stmt("INSERT INTO t VALUES ('a', 'K-2', 1)") },
      { type: "execute", stmt: stmt("SELECT slug, n FROM t") },
      { type: "close" },
    ]);
    expect(body.results[2].error.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
    expect(body.results[3].error.code).toBe("SQLITE_CONSTRAINT_PRIMARYKEY");
    expect(body.results[4].response.result.rows).toEqual([[{ type: "text", value: "a" }, { type: "integer", value: "7" }]]);
  });

  it("skips batch steps whose condition fails and rolls back a transaction left open", async () => {
    const fake = createHranaFake();
    fake.addDatabase(HOST, "t1");
    await pipeline(fake.fetch, "t1", [{ type: "execute", stmt: stmt("CREATE TABLE t (n INTEGER)") }]);
    const { body } = await pipeline(fake.fetch, "t1", [
      {
        type: "batch",
        batch: {
          steps: [
            { stmt: stmt("BEGIN IMMEDIATE") },
            { stmt: stmt("INSERT INTO t VALUES (1)"), condition: { type: "ok", step: 0 } },
            { stmt: stmt("INSERT INTO nowhere VALUES (1)"), condition: { type: "ok", step: 1 } },
            { stmt: stmt("COMMIT"), condition: { type: "ok", step: 2 } },
            { stmt: stmt("ROLLBACK"), condition: { type: "not", cond: { type: "ok", step: 3 } } },
          ],
        },
      },
    ]);
    const result = body.results[0].response.result;
    expect(result.step_errors[2]).not.toBeNull();
    expect(result.step_results[3]).toBeNull();
    expect(result.step_results[4]).not.toBeNull();
    const count = await pipeline(fake.fetch, "t1", [{ type: "execute", stmt: stmt("SELECT count(*) AS c FROM t") }]);
    expect(count.body.results[0].response.result.rows).toEqual([[{ type: "integer", value: "0" }]]);
  });

  it("refuses a wrong token with 401 and fails like a dropped network while offline", async () => {
    const fake = createHranaFake();
    fake.addDatabase(HOST, "t1");
    expect((await pipeline(fake.fetch, "nope", [])).status).toBe(401);
    fake.setOffline(true);
    await expect(pipeline(fake.fetch, "t1", [])).rejects.toThrow(TypeError);
    expect(fake.pipelines()).toBe(0);
  });
});

describe("the Turso fake", () => {
  it("creates a database the Hrana fake serves with the token it mints", async () => {
    const hrana = createHranaFake();
    const turso = createTursoFake(hrana);
    const auth = { Authorization: `Bearer ${turso.accountToken}` };
    const orgs = await (await turso.fetch("https://api.turso.tech/v1/organizations", { headers: auth })).json();
    expect(orgs.find((org: { type: string }) => org.type === "personal").slug).toBe("me");
    await turso.fetch("https://api.turso.tech/v1/organizations/me/groups", { method: "POST", headers: auth, body: JSON.stringify({ name: "default", location: "fra" }) });
    const created = await (
      await turso.fetch("https://api.turso.tech/v1/organizations/me/databases", { method: "POST", headers: auth, body: JSON.stringify({ name: "bb-tasks-tsk", group: "default" }) })
    ).json();
    expect(created.database.Hostname).toBe("bb-tasks-tsk-me.turso.io");
    const { jwt } = await (
      await turso.fetch("https://api.turso.tech/v1/organizations/me/databases/bb-tasks-tsk/auth/tokens?expiration=never&authorization=full-access", { method: "POST", headers: auth })
    ).json();
    const response = await turso.fetch("https://bb-tasks-tsk-me.turso.io/v2/pipeline", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ baton: null, requests: [{ type: "execute", stmt: { sql: "SELECT 1 AS one" } }] }),
    });
    expect(response.status).toBe(200);
  });
});
