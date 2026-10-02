// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { createHranaFake } from "../test-support/hrana-fake.js";

const hranaPath = "./hrana.js";
const { createHranaClient, describeUnreachable, unreachableSentence } = await planned<typeof import("./hrana.js")>(() => import(/* @vite-ignore */ hranaPath));

const HOST = "board-me.turso.io";
const URL_ = `libsql://${HOST}`;
const TOKEN = "secret-token-7f3a";

function setup(timeoutMs?: number) {
  const fake = createHranaFake();
  fake.addDatabase(HOST, TOKEN);
  const client = createHranaClient({ url: URL_, token: TOKEN, fetch: fake.fetch, ...(timeoutMs ? { timeoutMs } : {}) });
  return { fake, client };
}

/** A client whose every request gets this one reply. */
const replying = (response: () => Response) =>
  createHranaClient({ url: URL_, token: TOKEN, fetch: (async () => response()) as unknown as typeof fetch });

describe("a database that cannot be talked to says why", () => {
  it("a server error is the database unreachable, with the status and what the server said", async () => {
    const { fake, client } = setup();
    fake.respondWith(503);
    expect(await client.execute("SELECT 1")).toEqual({
      ok: false,
      error: { kind: "unreachable", why: { cause: "http", status: 503, detail: "unavailable" } },
    });
  });

  it("a dropped network is the database unreachable, with what the network said", async () => {
    const { fake, client } = setup();
    fake.setOffline(true);
    expect(await client.batch([{ sql: "SELECT 1" }])).toEqual({
      ok: false,
      error: { kind: "unreachable", why: { cause: "network", detail: "fetch failed" } },
    });
  });

  it("a reply that does not come in time is the database unreachable, with the wait it was given", async () => {
    const { fake, client } = setup(50);
    fake.setHanging(true);
    expect(await client.execute("SELECT 1")).toEqual({ ok: false, error: { kind: "unreachable", why: { cause: "timeout", ms: 50 } } });
  });

  it("a reply that is not JSON, or not a pipeline result, is the database unreachable as unreadable", async () => {
    expect(await replying(() => new Response("<html>gateway</html>")).execute("SELECT 1")).toMatchObject({
      ok: false,
      error: { kind: "unreachable", why: { cause: "unreadable" } },
    });
    expect(await replying(() => Response.json({ results: [] })).batch([{ sql: "SELECT 1" }])).toMatchObject({
      ok: false,
      error: { kind: "unreachable", why: { cause: "unreadable" } },
    });
  });

  it("keeps the token out of what the server said back", async () => {
    const echoed = await replying(() => new Response(`bad token ${TOKEN}`, { status: 400 })).execute("SELECT 1");
    expect(echoed).toMatchObject({ ok: false, error: { kind: "unreachable", why: { cause: "http", status: 400 } } });
    expect(JSON.stringify(echoed)).not.toContain(TOKEN);
  });

  it("keeps a long reply of the server to one short line", async () => {
    const long = await replying(() => new Response(`${"x".repeat(5000)}\n\nmore`, { status: 502 })).execute("SELECT 1");
    const why = (long as { error: { why: { detail: string } } }).error.why;
    expect(why.detail.length).toBeLessThanOrEqual(200);
    expect(why.detail).not.toContain("\n");
  });
});

describe("the reason in words", () => {
  it("names the wait in seconds, the status, the network's words and an unreadable reply", () => {
    expect(describeUnreachable({ cause: "timeout", ms: 10_000 })).toBe("it did not answer in 10 s");
    expect(describeUnreachable({ cause: "http", status: 429, detail: "rate limited" })).toBe("it answered HTTP 429: rate limited");
    expect(describeUnreachable({ cause: "http", status: 500, detail: "" })).toBe("it answered HTTP 500");
    expect(describeUnreachable({ cause: "network", detail: "getaddrinfo ENOTFOUND x.turso.io" })).toBe("the network failed: getaddrinfo ENOTFOUND x.turso.io");
    expect(describeUnreachable({ cause: "unreadable", detail: "the reply is not JSON" })).toBe("its reply could not be read: the reply is not JSON");
  });
});

/** A client whose every request fails the way fetch fails. */
const throwing = (error: unknown) =>
  createHranaClient({ url: URL_, token: TOKEN, fetch: (async () => { throw error; }) as unknown as typeof fetch });

describe("what the network said, when fetch only says «fetch failed»", () => {
  it("takes the words of the cause under it", async () => {
    const failed = await throwing(new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND x.turso.io") })).execute("SELECT 1");
    expect(failed).toMatchObject({ ok: false, error: { kind: "unreachable", why: { cause: "network" } } });
    expect((failed as { error: { why: { detail: string } } }).error.why.detail).toContain("ENOTFOUND");
  });

  it("takes the words of each address tried when the cause names none itself", async () => {
    const refused = Object.assign(new AggregateError([new Error("connect ECONNREFUSED ::1:443"), new Error("connect ECONNREFUSED 127.0.0.1:443")], ""), { code: "ECONNREFUSED" });
    const failed = await throwing(new TypeError("fetch failed", { cause: refused })).execute("SELECT 1");
    const detail = (failed as { error: { why: { detail: string } } }).error.why.detail;
    expect(detail).toContain("ECONNREFUSED ::1:443");
    expect(detail).toContain("ECONNREFUSED 127.0.0.1:443");
  });

  it("takes the code of a cause that has no words", async () => {
    const failed = await throwing(new TypeError("fetch failed", { cause: Object.assign(new Error(""), { code: "ETIMEDOUT" }) })).execute("SELECT 1");
    expect((failed as { error: { why: { detail: string } } }).error.why.detail).toContain("ETIMEDOUT");
  });
});

describe("the sentence the dialog, the error and the log share", () => {
  it("is one sentence with one full stop, whatever the server's words end with", () => {
    expect(unreachableSentence({ cause: "http", status: 503, detail: "unavailable" })).toBe("The database cannot be reached — it answered HTTP 503: unavailable.");
    expect(unreachableSentence({ cause: "http", status: 404, detail: "Not found." })).toBe("The database cannot be reached — it answered HTTP 404: Not found.");
    expect(unreachableSentence({ cause: "http", status: 502, detail: "Bad gateway…" })).toBe("The database cannot be reached — it answered HTTP 502: Bad gateway…");
  });

  it("is the bare sentence when no attempt was made to say why", () => {
    expect(unreachableSentence(null)).toBe("The database cannot be reached.");
  });
});
