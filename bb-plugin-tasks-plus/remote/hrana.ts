/**
 * The plugin's one network seam to a libSQL database (Turso or sqld):
 * Hrana over HTTP, a single endpoint `POST <https-address>/v2/pipeline` with
 * `Authorization: Bearer <token>`. Nothing from the rest of the plugin is
 * imported here — this is the shell of the `remote` layer.
 *
 * Every failure is a value: `unreachable` (network, 5xx, timeout), `auth`
 * (401, 403) or `sql` (a statement the database rejected, with its code). The
 * token goes into one header and into no report.
 */

export type HranaValue = string | number | null;
export type HranaRow = Readonly<Record<string, HranaValue>>;

export interface HranaRows {
  rows: HranaRow[];
  affectedRowCount: number;
}

export type HranaCondition =
  | { type: "ok"; step: number }
  | { type: "error"; step: number }
  | { type: "not"; cond: HranaCondition }
  | { type: "and"; conds: HranaCondition[] }
  | { type: "or"; conds: HranaCondition[] };

export interface HranaStep {
  sql: string;
  args?: readonly HranaValue[];
  condition?: HranaCondition;
}

export type HranaStepResult =
  | { kind: "ok"; rows: HranaRow[]; affectedRowCount: number }
  | { kind: "error"; code: string; message: string }
  | { kind: "skipped" };

export type HranaError =
  | { kind: "unreachable" }
  | { kind: "auth" }
  | { kind: "sql"; code: string; message: string };

export type HranaResult<T> = { ok: true; value: T } | { ok: false; error: HranaError };

export interface HranaClient {
  readonly url: string;
  execute(sql: string, args?: readonly HranaValue[]): Promise<HranaResult<HranaRows>>;
  batch(steps: readonly HranaStep[]): Promise<HranaResult<HranaStepResult[]>>;
}

export interface HranaClientOptions {
  url: string;
  token: string;
  /** Read from `globalThis` at the time of each call when not given. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const UNREACHABLE: HranaError = { kind: "unreachable" };
const AUTH: HranaError = { kind: "auth" };

const succeed = <T>(value: T): HranaResult<T> => ({ ok: true, value });
const fail = <T>(error: HranaError): HranaResult<T> => ({ ok: false, error });

// --- what goes out ---------------------------------------------------------

type WireValue = { type: "null" } | { type: "integer"; value: string } | { type: "float"; value: number } | { type: "text"; value: string };

type WireCondition =
  | { type: "ok"; step: number }
  | { type: "error"; step: number }
  | { type: "not"; cond: WireCondition }
  | { type: "and"; conds: WireCondition[] }
  | { type: "or"; conds: WireCondition[] };

interface WireStatement {
  sql: string;
  args: WireValue[];
  want_rows: true;
}

/** `libsql://host` is read as `https://host`; the pipeline lives under it. */
export function pipelineUrl(address: string): string {
  const base = address.replace(/^libsql:\/\//i, "https://").replace(/\/+$/, "");
  return `${base}/v2/pipeline`;
}

function toWireValue(value: HranaValue): WireValue {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "text", value };
  return Number.isInteger(value) ? { type: "integer", value: String(value) } : { type: "float", value };
}

function toWireStatement(sql: string, args: readonly HranaValue[] = []): WireStatement {
  return { sql, args: args.map(toWireValue), want_rows: true };
}

function toWireCondition(condition: HranaCondition): WireCondition {
  switch (condition.type) {
    case "ok":
    case "error":
      return { type: condition.type, step: condition.step };
    case "not":
      return { type: "not", cond: toWireCondition(condition.cond) };
    case "and":
    case "or":
      return { type: condition.type, conds: condition.conds.map(toWireCondition) };
  }
}

// --- what comes back -------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every item decoded, or null when any of them is not what the protocol says. */
function decodeAll<T>(items: unknown, decode: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(items)) return null;
  const decoded = items.map(decode);
  return decoded.every((item): item is T => item !== null) ? decoded : null;
}

function decodeValue(raw: unknown): HranaValue | undefined {
  if (!isRecord(raw)) return undefined;
  switch (raw.type) {
    case "null":
      return null;
    case "integer":
      return typeof raw.value === "string" && raw.value.trim() !== "" && Number.isFinite(Number(raw.value)) ? Number(raw.value) : undefined;
    case "float":
      return typeof raw.value === "number" ? raw.value : undefined;
    case "text":
      return typeof raw.value === "string" ? raw.value : undefined;
    // A blob has no place in a HranaValue: refused rather than passed off as text.
    default:
      return undefined;
  }
}

function decodeStatement(raw: unknown): HranaRows | null {
  if (!isRecord(raw)) return null;
  const names = decodeAll(raw.cols, (col) => (isRecord(col) && typeof col.name === "string" ? col.name : null));
  const rows = decodeAll(raw.rows, (row) => decodeRow(names, row));
  const affected = typeof raw.affected_row_count === "number" ? raw.affected_row_count : 0;
  return names === null || rows === null ? null : { rows, affectedRowCount: affected };
}

/** A row by column name; null when a value is not one the protocol names. */
function decodeRow(names: readonly string[] | null, raw: unknown): HranaRow | null {
  if (names === null || !Array.isArray(raw)) return null;
  const values = raw.map(decodeValue);
  if (values.some((value) => value === undefined)) return null;
  return Object.fromEntries(names.map((name, index) => [name, values[index] as HranaValue]));
}

function decodeError(raw: unknown): { code: string; message: string } {
  const error = isRecord(raw) ? raw : {};
  return {
    code: typeof error.code === "string" ? error.code : "SQLITE_ERROR",
    message: typeof error.message === "string" ? error.message : "the database rejected the statement",
  };
}

function decodeStepResult(result: unknown, error: unknown): HranaStepResult | null {
  if (isRecord(error)) return { kind: "error", ...decodeError(error) };
  if (result === null || result === undefined) return { kind: "skipped" };
  const rows = decodeStatement(result);
  return rows === null ? null : { kind: "ok", ...rows };
}

/** The first response of a pipeline, or null when the reply is not one. */
function firstResponse(body: unknown): { type: "ok"; response: Record<string, unknown> } | { type: "error"; error: unknown } | null {
  if (!isRecord(body) || !Array.isArray(body.results) || !isRecord(body.results[0])) return null;
  const first = body.results[0];
  if (first.type === "error") return { type: "error", error: first.error };
  return first.type === "ok" && isRecord(first.response) ? { type: "ok", response: first.response } : null;
}

function readExecute(body: unknown): HranaResult<HranaRows> {
  const first = firstResponse(body);
  if (first === null) return fail(UNREACHABLE);
  if (first.type === "error") return fail({ kind: "sql", ...decodeError(first.error) });
  const rows = decodeStatement(first.response.result);
  return rows === null ? fail(UNREACHABLE) : succeed(rows);
}

function readBatch(body: unknown): HranaResult<HranaStepResult[]> {
  const first = firstResponse(body);
  if (first === null) return fail(UNREACHABLE);
  if (first.type === "error") return fail({ kind: "sql", ...decodeError(first.error) });
  const result = first.response.result;
  if (!isRecord(result) || !Array.isArray(result.step_results)) return fail(UNREACHABLE);
  const results: unknown[] = result.step_results;
  const errors: unknown[] = Array.isArray(result.step_errors) ? result.step_errors : [];
  const decoded = results.map((raw, index) => decodeStepResult(raw, errors[index]));
  return decoded.every((step): step is HranaStepResult => step !== null) ? succeed(decoded) : fail(UNREACHABLE);
}

// --- the round trip --------------------------------------------------------

async function send(options: HranaClientOptions, request: unknown): Promise<HranaResult<unknown>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(pipelineUrl(options.url), {
      method: "POST",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
      body: JSON.stringify({ requests: [request, { type: "close" }] }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) return fail(AUTH);
    if (!response.ok) return fail(UNREACHABLE);
    return succeed(await response.json());
  } catch {
    // A dropped network, a timeout and a reply that is not JSON look alike
    // from here: the database cannot be talked to right now.
    return fail(UNREACHABLE);
  }
}

const andThen = <A, B>(result: HranaResult<A>, next: (value: A) => HranaResult<B>): HranaResult<B> =>
  result.ok ? next(result.value) : result;

export function createHranaClient(options: HranaClientOptions): HranaClient {
  return {
    url: options.url,
    async execute(sql, args) {
      const sent = await send(options, { type: "execute", stmt: toWireStatement(sql, args) });
      return andThen(sent, readExecute);
    },
    async batch(steps) {
      const wireSteps = steps.map((step) => ({
        stmt: toWireStatement(step.sql, step.args),
        ...(step.condition ? { condition: toWireCondition(step.condition) } : {}),
      }));
      const sent = await send(options, { type: "batch", batch: { steps: wireSteps } });
      return andThen(sent, readBatch);
    },
  };
}
