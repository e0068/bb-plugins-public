import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * A stand-in for libSQL servers (Turso or sqld) that speaks Hrana over HTTP:
 * `POST https://<host>/v2/pipeline` with `Authorization: Bearer <token>`.
 * Each host is an in-memory SQLite database from `node:sqlite`, so the SQL a
 * client sends really runs — constraints, `changes()`, transactions and all.
 * Tests hand `fake.fetch` to the code under test; nothing touches the network.
 *
 * Supported: `execute`, `batch` with `ok` / `error` / `not` / `and` / `or` /
 * `is_autocommit` conditions, `close`. Every pipeline is its own stream, as
 * without a baton on a real server: a transaction left open at its end is
 * rolled back.
 */

type WireValue =
  | { type: "null" }
  | { type: "integer"; value: string }
  | { type: "float"; value: number }
  | { type: "text"; value: string }
  | { type: "blob"; base64: string };

interface WireStatement {
  sql: string;
  args?: WireValue[];
  named_args?: { name: string; value: WireValue }[];
  want_rows?: boolean;
}

type WireCondition =
  | { type: "ok"; step: number }
  | { type: "error"; step: number }
  | { type: "not"; cond: WireCondition }
  | { type: "and"; conds: WireCondition[] }
  | { type: "or"; conds: WireCondition[] }
  | { type: "is_autocommit" };

type WireRequest =
  | { type: "execute"; stmt: WireStatement }
  | { type: "batch"; batch: { steps: { stmt: WireStatement; condition?: WireCondition | null }[] } }
  | { type: "close" };

interface StatementResult {
  cols: { name: string; decltype: null }[];
  rows: WireValue[][];
  affected_row_count: number;
  last_insert_rowid: string | null;
}

interface WireError {
  message: string;
  code: string;
}

export interface FakeDatabase {
  readonly host: string;
  /** `libsql://<host>` — the address a board is connected by. */
  readonly url: string;
}

export interface HranaFake {
  /** Answers `https://<host>/v2/pipeline` for every added host; any other address fails like a name that does not resolve. */
  readonly fetch: typeof fetch;
  /** A new empty database at `<host>` that accepts `token`. */
  addDatabase(host: string, token: string): FakeDatabase;
  /** A token the database at `host` stops accepting, as when it is revoked in the Turso dashboard. */
  revokeToken(host: string, token: string): void;
  /** One more token the database at `host` accepts. */
  allowToken(host: string, token: string): void;
  /** While true every request fails the way a dropped network does: `fetch` rejects. */
  setOffline(offline: boolean): void;
  /** While set every request is answered with this HTTP status and no work is done. */
  respondWith(status: number | null): void;
  /** While true every request hangs until its `signal` aborts. */
  setHanging(hanging: boolean): void;
  /** Pipelines that reached a database (offline, hanging and refused ones are not counted). */
  pipelines(): number;
}

const SQLITE_CODES: Record<number, string> = {
  1: "SQLITE_ERROR",
  5: "SQLITE_BUSY",
  19: "SQLITE_CONSTRAINT",
  275: "SQLITE_CONSTRAINT_CHECK",
  787: "SQLITE_CONSTRAINT_FOREIGNKEY",
  1299: "SQLITE_CONSTRAINT_NOTNULL",
  1555: "SQLITE_CONSTRAINT_PRIMARYKEY",
  2067: "SQLITE_CONSTRAINT_UNIQUE",
};

function wireError(error: unknown): WireError {
  const errcode = (error as { errcode?: unknown }).errcode;
  const message = error instanceof Error ? error.message : String(error);
  return {
    message: `SQLite error: ${message}`,
    code: typeof errcode === "number" ? (SQLITE_CODES[errcode] ?? "SQLITE_ERROR") : "SQLITE_ERROR",
  };
}

function fromWire(value: WireValue): SQLInputValue {
  switch (value.type) {
    case "null":
      return null;
    case "integer":
      return Number(value.value);
    case "float":
      return value.value;
    case "text":
      return value.value;
    case "blob":
      return Buffer.from(value.base64, "base64");
  }
}

function toWire(value: unknown): WireValue {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "bigint") return { type: "integer", value: value.toString() };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer", value: String(value) } : { type: "float", value };
  }
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Uint8Array) return { type: "blob", base64: Buffer.from(value).toString("base64") };
  return { type: "text", value: String(value) };
}

function runStatement(db: DatabaseSync, stmt: WireStatement): StatementResult {
  const prepared = db.prepare(stmt.sql);
  const named = Object.fromEntries(
    (stmt.named_args ?? []).map(({ name, value }) => [name.replace(/^[:@$]/, ""), fromWire(value)]),
  );
  const positional = (stmt.args ?? []).map(fromWire);
  const params: SQLInputValue[] = stmt.named_args?.length ? [named as unknown as SQLInputValue, ...positional] : positional;
  const columns = prepared.columns();
  if (columns.length > 0) {
    const rows = prepared.all(...params) as Record<string, unknown>[];
    return {
      cols: columns.map((column) => ({ name: column.name, decltype: null })),
      rows: rows.map((row) => columns.map((column) => toWire(row[column.name]))),
      affected_row_count: 0,
      last_insert_rowid: null,
    };
  }
  const outcome = prepared.run(...params);
  return {
    cols: [],
    rows: [],
    affected_row_count: Number(outcome.changes),
    last_insert_rowid: outcome.lastInsertRowid === undefined ? null : String(outcome.lastInsertRowid),
  };
}

function holds(
  condition: WireCondition,
  results: readonly (StatementResult | null)[],
  errors: readonly (WireError | null)[],
  db: DatabaseSync,
): boolean {
  switch (condition.type) {
    case "ok":
      return results[condition.step] != null;
    case "error":
      return errors[condition.step] != null;
    case "not":
      return !holds(condition.cond, results, errors, db);
    case "and":
      return condition.conds.every((cond) => holds(cond, results, errors, db));
    case "or":
      return condition.conds.some((cond) => holds(cond, results, errors, db));
    case "is_autocommit":
      return !db.isTransaction;
  }
}

function runBatch(db: DatabaseSync, steps: { stmt: WireStatement; condition?: WireCondition | null }[]) {
  const results: (StatementResult | null)[] = [];
  const errors: (WireError | null)[] = [];
  for (const step of steps) {
    if (step.condition && !holds(step.condition, results, errors, db)) {
      results.push(null);
      errors.push(null);
      continue;
    }
    try {
      results.push(runStatement(db, step.stmt));
      errors.push(null);
    } catch (error) {
      results.push(null);
      errors.push(wireError(error));
    }
  }
  return { step_results: results, step_errors: errors };
}

function runRequest(db: DatabaseSync, request: WireRequest) {
  switch (request.type) {
    case "execute":
      try {
        return { type: "ok", response: { type: "execute", result: runStatement(db, request.stmt) } };
      } catch (error) {
        return { type: "error", error: wireError(error) };
      }
    case "batch":
      return { type: "ok", response: { type: "batch", result: runBatch(db, request.batch.steps) } };
    case "close":
      return { type: "ok", response: { type: "close" } };
  }
}

function abortable(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function createHranaFake(): HranaFake {
  const databases = new Map<string, { db: DatabaseSync; tokens: Set<string> }>();
  let offline = false;
  let forcedStatus: number | null = null;
  let hanging = false;
  let pipelines = 0;

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const database = databases.get(url.host);
    if (offline || database === undefined) throw new TypeError("fetch failed");
    if (hanging) return abortable(init?.signal);
    if (forcedStatus !== null) return new Response("unavailable", { status: forcedStatus });
    if (url.protocol !== "https:" || url.pathname !== "/v2/pipeline" || (init?.method ?? "GET") !== "POST") {
      return new Response("Not Found", { status: 404 });
    }
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!database.tokens.has(token)) return new Response("Unauthorized", { status: 401 });
    const body = JSON.parse(String(init?.body ?? "{}")) as { requests?: WireRequest[] };
    pipelines += 1;
    const results = (body.requests ?? []).map((request) => runRequest(database.db, request));
    if (database.db.isTransaction) database.db.exec("ROLLBACK");
    return json(200, { baton: null, base_url: null, results });
  };

  return {
    fetch: fakeFetch as typeof fetch,
    addDatabase(host, token) {
      databases.set(host, { db: new DatabaseSync(":memory:"), tokens: new Set([token]) });
      return { host, url: `libsql://${host}` };
    },
    allowToken(host, token) {
      databases.get(host)?.tokens.add(token);
    },
    revokeToken(host, token) {
      databases.get(host)?.tokens.delete(token);
    },
    setOffline(value) {
      offline = value;
    },
    respondWith(status) {
      forcedStatus = status;
    },
    setHanging(value) {
      hanging = value;
    },
    pipelines: () => pipelines,
  };
}
