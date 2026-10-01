// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake } from "../test-support/hrana-fake.js";

const hranaPath = "./hrana.js";
const { createHranaClient } = await planned<typeof import("./hrana.js")>(() => import(/* @vite-ignore */ hranaPath));

const HOST = "board-me.turso.io";
const URL_ = `libsql://${HOST}`;
const TOKEN = "secret-token-7f3a";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const fake = createHranaFake();
  fake.addDatabase(HOST, TOKEN);
  const client = createHranaClient({ url: URL_, token: TOKEN, fetch: fake.fetch });
  return { fake, client };
}

async function ok<T>(result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>): Promise<T> {
  const settled = await result;
  expect(settled, JSON.stringify(settled)).toMatchObject({ ok: true });
  return (settled as { ok: true; value: T }).value;
}

describe("talking to a libSQL database over Hrana", () => {
  it("posts to /v2/pipeline over https with the token as a bearer", async () => {
    const fake = createHranaFake();
    fake.addDatabase(HOST, TOKEN);
    const seen: { url: string; authorization: string | null }[] = [];
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
      return fake.fetch(input, init);
    }) as typeof fetch;
    const client = createHranaClient({ url: URL_, token: TOKEN, fetch: recording });
    await ok(client.execute("SELECT 1 AS one"));
    expect(seen).toEqual([{ url: `https://${HOST}/v2/pipeline`, authorization: `Bearer ${TOKEN}` }]);
  });

  it("gives rows by column name, integers as numbers, text as strings and NULL as null", async () => {
    const { client } = setup();
    await ok(client.execute("CREATE TABLE t (slug TEXT PRIMARY KEY, n INTEGER, note TEXT)"));
    await ok(client.execute("INSERT INTO t VALUES (?, ?, ?)", ["a", 12, null]));
    const { rows } = await ok(client.execute("SELECT slug, n, note FROM t"));
    expect(rows).toEqual([{ slug: "a", n: 12, note: null }]);
  });

  it("counts the rows a statement changed", async () => {
    const { client } = setup();
    await ok(client.execute("CREATE TABLE t (n INTEGER)"));
    await ok(client.execute("INSERT INTO t VALUES (1), (2)"));
    expect((await ok(client.execute("UPDATE t SET n = n + 1"))).affectedRowCount).toBe(2);
  });

  it("runs a batch in order and skips a step whose condition fails, so a failed write rolls back", async () => {
    const { client } = setup();
    await ok(client.execute("CREATE TABLE t (n INTEGER UNIQUE)"));
    await ok(client.execute("INSERT INTO t VALUES (1)"));
    const steps = await ok(
      client.batch([
        { sql: "BEGIN IMMEDIATE" },
        { sql: "INSERT INTO t VALUES (2)", condition: { type: "ok", step: 0 } },
        { sql: "INSERT INTO t VALUES (1)", condition: { type: "ok", step: 1 } },
        { sql: "COMMIT", condition: { type: "ok", step: 2 } },
        { sql: "ROLLBACK", condition: { type: "not", cond: { type: "ok", step: 3 } } },
      ]),
    );
    expect(steps.map((step) => step.kind)).toEqual(["ok", "ok", "error", "skipped", "ok"]);
    expect(steps[2]).toMatchObject({ kind: "error", code: "SQLITE_CONSTRAINT_UNIQUE" });
    expect((await ok(client.execute("SELECT count(*) AS c FROM t"))).rows).toEqual([{ c: 1 }]);
  });

  it("lets a batch step see the rows the step before it changed", async () => {
    const { client } = setup();
    await ok(client.execute("CREATE TABLE t (n INTEGER)"));
    await ok(client.execute("CREATE TABLE c (seq INTEGER)"));
    await ok(client.execute("INSERT INTO c VALUES (0)"));
    await ok(
      client.batch([
        { sql: "INSERT INTO t VALUES (1)" },
        { sql: "UPDATE c SET seq = seq + 1 WHERE changes() > 0", condition: { type: "ok", step: 0 } },
      ]),
    );
    expect((await ok(client.execute("SELECT seq FROM c"))).rows).toEqual([{ seq: 1 }]);
  });
});

describe("failures are values, never exceptions", () => {
  it("a statement the database rejects is an sql error with its code", async () => {
    const { client } = setup();
    await ok(client.execute("CREATE TABLE t (slug TEXT PRIMARY KEY, key TEXT UNIQUE)"));
    await ok(client.execute("INSERT INTO t VALUES ('a', 'K-1')"));
    expect(await client.execute("INSERT INTO t VALUES ('b', 'K-1')")).toMatchObject({ ok: false, error: { kind: "sql", code: "SQLITE_CONSTRAINT_UNIQUE" } });
    expect(await client.execute("INSERT INTO t VALUES ('a', 'K-2')")).toMatchObject({ ok: false, error: { kind: "sql", code: "SQLITE_CONSTRAINT_PRIMARYKEY" } });
  });

  it("a refused token is an auth error, 401 and 403 alike", async () => {
    const { fake } = setup();
    const wrong = createHranaClient({ url: URL_, token: "not-the-token", fetch: fake.fetch });
    expect(await wrong.execute("SELECT 1")).toEqual({ ok: false, error: { kind: "auth" } });
    fake.respondWith(403);
    expect(await createHranaClient({ url: URL_, token: TOKEN, fetch: fake.fetch }).execute("SELECT 1")).toEqual({ ok: false, error: { kind: "auth" } });
  });

  it("a server error, a dropped network and a timeout are the database being unreachable", async () => {
    const { fake, client } = setup();
    fake.respondWith(503);
    expect(await client.execute("SELECT 1")).toEqual({ ok: false, error: { kind: "unreachable" } });
    fake.respondWith(null);
    fake.setOffline(true);
    expect(await client.batch([{ sql: "SELECT 1" }])).toEqual({ ok: false, error: { kind: "unreachable" } });
    fake.setOffline(false);
    fake.setHanging(true);
    const slow = createHranaClient({ url: URL_, token: TOKEN, fetch: fake.fetch, timeoutMs: 50 });
    expect(await slow.execute("SELECT 1")).toEqual({ ok: false, error: { kind: "unreachable" } });
  });

  it("never puts the token into what it reports", async () => {
    const { fake, client } = setup();
    const reports = [
      await client.execute("SELECT * FROM nowhere"),
      await createHranaClient({ url: URL_, token: `${TOKEN}-wrong`, fetch: fake.fetch }).execute("SELECT 1"),
    ];
    fake.setOffline(true);
    reports.push(await client.execute("SELECT 1"));
    for (const report of reports) {
      expect(report.ok).toBe(false);
      expect(JSON.stringify(report)).not.toContain(TOKEN);
    }
  });
});

describe("the fetch it uses", () => {
  it("is the global one at the time of the call when none is given", async () => {
    const fake = createHranaFake();
    fake.addDatabase(HOST, TOKEN);
    const client = createHranaClient({ url: URL_, token: TOKEN });
    vi.stubGlobal("fetch", fake.fetch);
    expect((await ok(client.execute("SELECT 2 AS two"))).rows).toEqual([{ two: 2 }]);
  });
});
