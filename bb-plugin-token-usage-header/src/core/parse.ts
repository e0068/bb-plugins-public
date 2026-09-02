// Parses the raw stdout text of `tools/tokens.py --json` into a typed
// result. No I/O here — the caller (src/service) is responsible for
// actually running the process; this module only ever sees a string.
//
// Never throws: malformed input from an external process is an expected
// case, not a bug, so every failure comes back as a tagged result the
// caller must handle explicitly.
import type {
  BucketModelUsage,
  TokensAgentInfo,
  TokensBucket,
  TokensBy,
  TokensReport,
  TokensScriptError,
  TokensTotals,
} from "./types";
import { EXPECTED_SCHEMA_VERSION } from "./types";

export type ParseFailureReason =
  | "invalid_json"
  | "invalid_shape"
  | "script_error"
  | "schema_version_mismatch";

export interface ParseSuccess {
  ok: true;
  data: TokensReport;
}

export interface ParseFailure {
  ok: false;
  reason: ParseFailureReason;
  message: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

const VALID_BY: readonly TokensBy[] = ["session", "project", "agent", "workflow", "model", "day"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parses the per-model breakdown: an array of "tier — usage" pairs, as
 * returned by tools/tokens.py. An empty array is legal — a bucket with no
 * model records at all.
 */
function validateModels(v: unknown, path: string): BucketModelUsage[] | string {
  if (!Array.isArray(v)) return `${path} must be an array`;
  const out: BucketModelUsage[] = [];
  for (const [i, item] of v.entries()) {
    if (!isRecord(item)) return `${path}[${i}] must be an object`;
    if (typeof item.tier !== "string") return `${path}[${i}].tier must be a string`;
    if (!isNumber(item.total)) return `${path}[${i}].total must be a number`;
    out.push({ tier: item.tier, total: item.total });
  }
  return out;
}

function fail(reason: ParseFailureReason, message: string): ParseFailure {
  return { ok: false, reason, message };
}

function validateAgent(v: unknown, path: string): TokensAgentInfo | null | string {
  if (v === null || v === undefined) return null;
  if (!isRecord(v)) return `${path} must be an object or null`;
  if (typeof v.id !== "string") return `${path}.id must be a string`;
  if (!isStringOrNull(v.description)) return `${path}.description must be a string or null`;
  if (!isStringOrNull(v.agentType)) return `${path}.agentType must be a string or null`;
  if (!isStringOrNull(v.model)) return `${path}.model must be a string or null`;
  if (!isStringOrNull(v.workflowRunId)) return `${path}.workflowRunId must be a string or null`;
  return {
    id: v.id,
    description: v.description,
    agentType: v.agentType,
    model: v.model,
    workflowRunId: v.workflowRunId,
  };
}

const NUMERIC_BUCKET_FIELDS = [
  "total",
  "input",
  "cacheWrite5m",
  "cacheWrite1h",
  "cacheRead",
  "output",
  "thinking",
  "messages",
  "cost",
] as const;

function validateBucket(v: unknown, index: number): TokensBucket | string {
  const path = `buckets[${index}]`;
  if (!isRecord(v)) return `${path} must be an object`;
  if (typeof v.key !== "string") return `${path}.key must be a string`;
  if (!isStringOrNull(v.sessionId)) return `${path}.sessionId must be a string or null`;
  if (!isStringOrNull(v.project)) return `${path}.project must be a string or null`;
  if (!isStringOrNull(v.firstAt)) return `${path}.firstAt must be a string or null`;
  if (!isStringOrNull(v.lastAt)) return `${path}.lastAt must be a string or null`;
  const models = validateModels(v.models, `${path}.models`);
  if (typeof models === "string") return models;

  for (const field of NUMERIC_BUCKET_FIELDS) {
    if (!isNumber(v[field])) return `${path}.${field} must be a number`;
  }

  const agent = validateAgent(v.agent, `${path}.agent`);
  if (typeof agent === "string") return agent;

  return {
    key: v.key,
    sessionId: v.sessionId,
    project: v.project,
    agent,
    total: v.total as number,
    input: v.input as number,
    cacheWrite5m: v.cacheWrite5m as number,
    cacheWrite1h: v.cacheWrite1h as number,
    cacheRead: v.cacheRead as number,
    output: v.output as number,
    thinking: v.thinking as number,
    messages: v.messages as number,
    cost: v.cost as number,
    models,
    firstAt: v.firstAt,
    lastAt: v.lastAt,
  };
}

const COST_BREAKDOWN_FIELDS = ["input", "cacheWrite", "cacheRead", "output", "thinking"] as const;

function validateCosts(v: unknown): TokensTotals["costs"] | string {
  if (!isRecord(v)) return "totals.costs must be an object";
  for (const field of COST_BREAKDOWN_FIELDS) {
    if (!isNumber(v[field])) return `totals.costs.${field} must be a number`;
  }
  return {
    input: v.input as number,
    cacheWrite: v.cacheWrite as number,
    cacheRead: v.cacheRead as number,
    output: v.output as number,
    thinking: v.thinking as number,
  };
}

function validateTotals(v: unknown): TokensTotals | string {
  if (!isRecord(v)) return "totals must be an object";
  for (const field of NUMERIC_BUCKET_FIELDS) {
    if (!isNumber(v[field])) return `totals.${field} must be a number`;
  }
  if (!isNumber(v.buckets)) return "totals.buckets must be a number";
  const models = validateModels(v.models, "totals.models");
  if (typeof models === "string") return models;
  const costs = validateCosts(v.costs);
  if (typeof costs === "string") return costs;
  return {
    total: v.total as number,
    input: v.input as number,
    cacheWrite5m: v.cacheWrite5m as number,
    cacheWrite1h: v.cacheWrite1h as number,
    cacheRead: v.cacheRead as number,
    output: v.output as number,
    thinking: v.thinking as number,
    messages: v.messages as number,
    cost: v.cost as number,
    costs,
    models,
    buckets: v.buckets as number,
  };
}

/**
 * Parses the stdout of `tokens.py --json` (or `--json` in any --by mode).
 * Returns a tagged result — never throws.
 */
export function parseTokensOutput(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail("invalid_json", "empty output");
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    return fail("invalid_json", `not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!isRecord(json)) {
    return fail("invalid_shape", "expected a JSON object at the top level");
  }

  // tokens.py's top-level exception handler prints {"error": "..."} and
  // nothing else — distinguish that from a malformed real report.
  if (typeof json.error === "string" && !("buckets" in json)) {
    return fail("script_error", json.error);
  }

  // Checked before buckets/totals and anything else: a version mismatch
  // means the built plugin and tools/tokens.py on disk speak different
  // dialects of the format, and the failure must name that instead of the
  // first data field the parser happens to reach. See the decision in
  // memory/decisions/token-usage-json-schema-version.md.
  if (json.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    const got =
      json.schemaVersion === undefined
        ? "the schema version field is missing"
        : `got version ${JSON.stringify(json.schemaVersion)}`;
    // The direction of the mismatch is fixed differently depending on sign:
    // version GREATER than expected — the counter on disk is newer than the
    // built bundle knows about, so the build is stale. Version LESS than
    // expected, or the field missing altogether — tools/tokens.py itself on
    // disk is stale (it isn't produced by the build, it's read as-is — see
    // defaultScriptPath in src/service/tokens-runner.ts), and rebuilding the
    // plugin would just produce the same message again.
    const remedy =
      typeof json.schemaVersion === "number" && json.schemaVersion > EXPECTED_SCHEMA_VERSION
        ? "Rebuild the plugin."
        : "Rebuilding the plugin won't help: update the plugin installation or check which tree tools/tokens.py is being read from.";
    return fail(
      "schema_version_mismatch",
      `Plugin was built against a different version of the tools/tokens.py counter: expected schema version ${EXPECTED_SCHEMA_VERSION}, ${got}. ${remedy}`,
    );
  }

  if (typeof json.by !== "string" || !VALID_BY.includes(json.by as TokensBy)) {
    return fail("invalid_shape", `"by" must be one of ${VALID_BY.join(", ")}`);
  }
  if (!Array.isArray(json.buckets)) {
    return fail("invalid_shape", '"buckets" must be an array');
  }
  if (typeof json.truncated !== "boolean") {
    return fail("invalid_shape", '"truncated" must be a boolean');
  }

  const buckets: TokensBucket[] = [];
  for (let i = 0; i < json.buckets.length; i++) {
    const result = validateBucket(json.buckets[i], i);
    if (typeof result === "string") {
      return fail("invalid_shape", result);
    }
    buckets.push(result);
  }

  const totals = validateTotals(json.totals);
  if (typeof totals === "string") {
    return fail("invalid_shape", totals);
  }

  return {
    ok: true,
    data: {
      by: json.by as TokensBy,
      buckets,
      totals,
      truncated: json.truncated,
    },
  };
}

/** True when a parsed JSON value looks like tokens.py's `{"error": "..."}` output. */
export function isScriptError(json: unknown): json is TokensScriptError {
  return isRecord(json) && typeof json.error === "string" && !("buckets" in json);
}
