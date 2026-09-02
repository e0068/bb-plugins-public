// Types mirroring the JSON contract emitted by tools/tokens.py --json.
//
// This file has no I/O and no dependencies — it only describes shapes. Keep
// it in lockstep with tools/tokens.py: bucket_json() / main()'s `totals` and
// `out` dicts are the source of truth for this shape.

/**
 * Version of the --json report format understood by this bundle. Must match
 * SCHEMA_VERSION in tools/tokens.py — the counter script is read from disk on
 * every call, while this file lives in the built bundle and only gets
 * updated on rebuild; on a mismatch, parse.ts must report the version
 * instead of guessing from the fields. See
 * memory/decisions/token-usage-json-schema-version.md and
 * __tests__/contract-sync.test.tsx for a similar guard.
 */
export const EXPECTED_SCHEMA_VERSION = 2;

/** Available cuts (`--by`). */
export type TokensBy = "session" | "project" | "agent" | "workflow" | "model" | "day";

/**
 * Structured info about the agent invocation a bucket belongs to.
 * Present only for buckets that correspond to exactly one subagent call
 * (typically under `--by agent`); absent/null for the main agent and for
 * buckets that aggregate across multiple agents (session, project, model, day).
 */
export interface TokensAgentInfo {
  /** Bare hash id, e.g. "a9e92d5bea00f5cb7" (without the "agent-" prefix). */
  id: string;
  /** Human label the call was launched with, e.g. "H1: plugin scaffold and JSON mode". */
  description: string | null;
  agentType: string | null;
  model: string | null;
  /** Name of the workflow run directory, when this agent ran inside a workflow. */
  workflowRunId: string | null;
}

/** How many of a bucket's tokens fall on one model tier. */
export interface BucketModelUsage {
  tier: string;
  total: number;
}

/** One row of the report: a single bucket for the chosen `--by` cut. */
export interface TokensBucket {
  /** Stable bucket identifier. For `--by agent`: "agent-<hash>" or "main". */
  key: string;
  /** Claude Code session id, or null when the bucket spans more than one session. */
  sessionId: string | null;
  /** Project path slug (directory name under ~/.claude/projects), or null when it spans more than one project. */
  project: string | null;
  /** Structured agent info, or null when not applicable / not a single agent call. */
  agent: TokensAgentInfo | null;

  total: number;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  thinking: number;
  messages: number;
  /** Estimated cost in USD, rounded to cents. */
  cost: number;
  /**
   * Usage per model tier encountered in the bucket, in descending order.
   * A bucket is almost never homogeneous: over the course of a session the
   * main agent can end up working across several models, and a single name
   * would pick a winner arbitrarily.
   */
  models: BucketModelUsage[];
  /** ISO 8601 UTC timestamp of the earliest record in the bucket, or null. */
  firstAt: string | null;
  /** ISO 8601 UTC timestamp of the latest record in the bucket, or null. */
  lastAt: string | null;
}

/**
 * Cost of the total broken down by token kind (USD). input+cacheWrite+
 * cacheRead+output sum up to `cost`; thinking is part of output, on top of
 * the sum. Computed by tools/tokens.py (pricing and multipliers live there);
 * do not recompute it on the client.
 */
export interface TokensCostBreakdown {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  thinking: number;
}

/** Grand totals across every bucket, not just the (possibly truncated) top N shown. */
export interface TokensTotals {
  total: number;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  thinking: number;
  messages: number;
  cost: number;
  /** Breakdown of `cost` by token kind — for the cost shown on each breakdown row. */
  costs: TokensCostBreakdown;
  models: BucketModelUsage[];
  /** Total number of buckets before truncation to --top. */
  buckets: number;
}

/** The full report produced by `tokens.py --json`. */
export interface TokensReport {
  by: TokensBy;
  buckets: TokensBucket[];
  totals: TokensTotals;
  /** True when `buckets` was truncated to --top and more buckets exist. */
  truncated: boolean;
}

/** The error object tokens.py prints (with --json) when it fails. */
export interface TokensScriptError {
  error: string;
}
