// Runs tools/agent_timeline.py --json and turns whatever it produces into a
// typed result. Mirrors src/service/tokens-runner.ts's shape (interpreter
// fallback, shared deadline, stderr-folding on empty stdout) and reuses its
// process-running/interpreter-resolution plumbing — this module only adds
// the script's own CLI contract (--session/--agent) and its own cache, kept
// separate from the tokens.py cache because the two scripts, params, and
// report shapes are unrelated.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
// Imported directly from src/core/agent-timeline (not the ../core barrel):
// src/core/index.ts is outside this group's file map, and re-exporting a new
// core module through it is a decision for whoever owns that barrel.
import { parseAgentTimeline, type AgentTimeline, type AgentTimelinePrNumber } from "../core/agent-timeline";
import type { GitEvent } from "../core/git-events";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  runProcess,
  type ProcessRunner,
  type ProcessRunResult,
} from "./process-runner";
import { resolvePluginRoot } from "./tokens-runner";

/** Interpreters tried in order; whichever works first is remembered. */
const INTERPRETER_CANDIDATES = ["python3", "python"] as const;
type Interpreter = (typeof INTERPRETER_CANDIDATES)[number];

/**
 * Resolves tools/agent_timeline.py the same way tokens-runner.ts resolves
 * tools/tokens.py: from this module's own location (not process.cwd()),
 * walking up for the plugin root so both a source checkout and a
 * `bb plugin build` bundle (dist/server.js one level above the plugin root)
 * resolve correctly. Reuses `resolvePluginRoot`, which only needs
 * `tools/tokens.py` as its landmark — both scripts live in the same `tools/`
 * directory, so finding one finds the other.
 */
export function defaultAgentTimelineScriptPath(): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  const root = resolvePluginRoot(startDir) ?? join(startDir, "..", "..");
  return join(root, "tools", "agent_timeline.py");
}

export interface AgentTimelineQueryParams {
  /** Claude Code session id, or a prefix of one — agent_timeline.py matches with `startswith`. */
  session: string;
  /** "main" or "agent-<hash>". Defaults to "main" (the script's own default) when omitted. */
  agent?: string;
}

export type AgentTimelineRunFailureReason =
  | "invalid_session"
  | "python_not_found"
  | "timeout"
  | "output_limit"
  | "script_error"
  | "invalid_output"
  | "process_error";

export type AgentTimelineRunResult =
  | { ok: true; data: AgentTimeline }
  | { ok: false; reason: AgentTimelineRunFailureReason; message: string };

function buildArgs(scriptPath: string, params: AgentTimelineQueryParams): string[] {
  const args = [scriptPath, "--json", "--session", params.session];
  if (params.agent) args.push("--agent", params.agent);
  return args;
}

function mapProcessFailure(result: Extract<ProcessRunResult, { ok: false }>): AgentTimelineRunResult {
  const reason = result.reason === "not_found" ? "python_not_found" : result.reason === "spawn_error" ? "process_error" : result.reason;
  return { ok: false, reason, message: result.message };
}

// See tokens-runner.ts's mapStdout for why stderr/exit-code get folded in on
// invalid_output but not on a recognized script_error envelope.
function mapStdout(result: Extract<ProcessRunResult, { ok: true }>): AgentTimelineRunResult {
  const parsed = parseAgentTimeline(result.stdout);
  if (parsed.ok) return { ok: true, data: parsed.data };
  if (parsed.reason === "script_error") {
    return { ok: false, reason: "script_error", message: parsed.message };
  }
  const diagnostic = result.stderr.trim();
  const message = diagnostic
    ? `${parsed.message} (exit code ${result.code}): ${diagnostic}`
    : parsed.message;
  return { ok: false, reason: "invalid_output", message };
}

export interface AgentTimelineRunnerOptions {
  /** Defaults to the real `node:child_process`-backed runner. */
  processRunner?: ProcessRunner;
  scriptPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface AgentTimelineRunner {
  run(params: AgentTimelineQueryParams): Promise<AgentTimelineRunResult>;
}

/**
 * Builds a runner that finds a Python interpreter, invokes
 * tools/agent_timeline.py with the given (session, agent), and parses the
 * result. Never throws — every failure mode comes back as a tagged result.
 */
export function createAgentTimelineRunner(options: AgentTimelineRunnerOptions = {}): AgentTimelineRunner {
  const processRunner = options.processRunner ?? runProcess;
  const scriptPath = options.scriptPath ?? defaultAgentTimelineScriptPath();
  const totalTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  let cachedInterpreter: Interpreter | null = null;

  return {
    async run(params) {
      // Empty string is not "no session filter" here the way it is for
      // tokens.py's optional --session: this script's --session is
      // required, and an empty string would resolve no transcript at all,
      // surfacing as a confusing "session not found" from the script
      // instead of a clear client-side rejection.
      if (params.session === "") {
        return {
          ok: false,
          reason: "invalid_session",
          message: "An empty session id is not allowed.",
        };
      }

      const args = buildArgs(scriptPath, params);
      const order: readonly Interpreter[] = cachedInterpreter
        ? [cachedInterpreter, ...INTERPRETER_CANDIDATES.filter((c) => c !== cachedInterpreter)]
        : INTERPRETER_CANDIDATES;

      const deadline = Date.now() + totalTimeoutMs;

      for (const interpreter of order) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          return {
            ok: false,
            reason: "timeout",
            message: `Overall time budget (${totalTimeoutMs}ms) exceeded before attempting to run "${interpreter}"`,
          };
        }

        const result = await processRunner(interpreter, args, { timeoutMs: remainingMs, maxOutputBytes });
        if (result.ok) {
          cachedInterpreter = interpreter;
          return mapStdout(result);
        }
        if (result.reason !== "not_found") {
          return mapProcessFailure(result);
        }
        if (cachedInterpreter === interpreter) cachedInterpreter = null;
      }

      return {
        ok: false,
        reason: "python_not_found",
        message:
          "Python interpreter (python3 or python) not found in PATH. Install Python 3 and make sure the python3 command is available.",
      };
    },
  };
}

/** Canonical cache key for a query — missing `agent` normalized to "main". */
function cacheKeyFor(params: AgentTimelineQueryParams): string {
  return JSON.stringify({ session: params.session, agent: params.agent ?? "main" });
}

const DEFAULT_CACHE_TTL_MS = 30_000;

// --- Merge status (live `gh pr view`) --------------------------------
//
// The session page's own enrichment — see
// memory/decisions/merge-marker-session-page-only.md for why this call
// only ever happens here (one PR at a time, on-demand), never for the
// feed/popup's threadsTimeline slice.

/** Longer than GIT_CALL_TIMEOUT_MS in threads-timeline-service.ts: `gh` is a real network round trip to GitHub, not a local git op. */
const GH_CALL_TIMEOUT_MS = 8_000;

/** The subset of `gh pr view --json state,url,mergedAt`'s output this module cares about — undefined/wrong-typed fields make the whole parse fail rather than guess. */
function parseGhPrView(stdout: string): { state: string; url: string; mergedAt: string | null } | null {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const { state, url, mergedAt } = json as Record<string, unknown>;
  if (typeof state !== "string" || typeof url !== "string") return null;
  return { state, url, mergedAt: typeof mergedAt === "string" ? mergedAt : null };
}

/** One PR's merge status, or null when it isn't merged (or `gh` failed/isn't installed/isn't authenticated) — never throws. */
async function mergeEventFor(pr: AgentTimelinePrNumber, processRunner: ProcessRunner): Promise<GitEvent | null> {
  const result = await processRunner(
    "gh",
    ["pr", "view", String(pr.number), "--repo", pr.repository, "--json", "state,url,mergedAt"],
    { timeoutMs: GH_CALL_TIMEOUT_MS },
  );
  if (!result.ok || result.code !== 0) return null;
  const parsed = parseGhPrView(result.stdout);
  if (!parsed || parsed.state !== "MERGED" || !parsed.mergedAt) return null;
  return { type: "merge", ts: parsed.mergedAt, number: pr.number, url: parsed.url, repository: pr.repository };
}

/**
 * Resolves every PR the session touched to a "merge" GitEvent, dropping the
 * ones that aren't merged (open/closed-unmerged — nothing to mark). Runs the
 * `gh` calls in parallel; a lookup failure for one PR (or all of them —
 * `gh` missing/unauthenticated/network down) degrades to no merge events,
 * never fails the whole agentTimeline response.
 */
async function resolveMergeEvents(prNumbers: readonly AgentTimelinePrNumber[], processRunner: ProcessRunner): Promise<GitEvent[]> {
  if (prNumbers.length === 0) return [];
  try {
    const results = await Promise.all(prNumbers.map((pr) => mergeEventFor(pr, processRunner)));
    return results.filter((event): event is GitEvent => event !== null);
  } catch (err) {
    console.error("[agent-timeline-service] merge status lookup failed, leaving mergeEvents empty:", err);
    return [];
  }
}

export interface AgentTimelineServiceOptions extends AgentTimelineRunnerOptions {
  /** Cache TTL in ms; defaults to 30s (same default as src/service/cache.ts). */
  cacheTtlMs?: number;
  now?: () => number;
}

export interface AgentTimelineService {
  /** Runs (or serves from cache) tools/agent_timeline.py for one (session, agent). */
  query(params: AgentTimelineQueryParams): Promise<AgentTimelineRunResult>;
  /** Drops every cached entry, including in-flight ones. */
  clearCache(): void;
}

/**
 * Builds the query-facing service: runner + a short-lived in-memory cache
 * keyed by (session, agent), so re-opening the same agent's detail panel
 * within the TTL doesn't re-spawn python. Deliberately its own cache
 * instance rather than reusing src/service/cache.ts's `TokensCache` — same
 * shape, but keyed on and caching a different report type; sharing one
 * generic cache across two unrelated result types would need a wider
 * (weaker) value type on every read.
 *
 * Takes `bb` for the same reason createTokenUsageService does — a uniform
 * factory signature across this plugin's services — even though this
 * particular service doesn't call out to `bb.sdk` itself: callers already
 * have a resolved `session`/`agent` (e.g. from TokenUsageService's own
 * thread->session resolution) by the time they reach here.
 */
export function createAgentTimelineService(bb: BbPluginApi, options: AgentTimelineServiceOptions = {}): AgentTimelineService {
  void bb;
  const runner = createAgentTimelineRunner(options);
  const processRunner = options.processRunner ?? runProcess;
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  const entries = new Map<string, { expiresAt: number; promise: Promise<AgentTimelineRunResult> }>();

  return {
    query(params) {
      const key = cacheKeyFor(params);
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) {
        return existing.promise;
      }

      // mergeEvents is resolved once per (uncached) query, folded into the
      // same cached promise as the script's own result — a cache hit above
      // skips both the python process and the `gh pr view` calls together.
      const promise = runner.run(params).then(async (result): Promise<AgentTimelineRunResult> => {
        if (!result.ok) return result;
        const mergeEvents = await resolveMergeEvents(result.data.prNumbers, processRunner);
        return { ok: true, data: { ...result.data, mergeEvents } };
      });
      const entry = { expiresAt: now() + ttlMs, promise };
      entries.set(key, entry);

      const dropIfCurrent = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      promise.catch(dropIfCurrent);
      // Failures aren't cached — same reasoning as src/service/cache.ts:
      // they're usually about the environment (python not found, session
      // temporarily unavailable) rather than about the data, and shouldn't
      // keep the user stuck on a stale error for the whole TTL.
      promise.then((result) => {
        if (!result.ok) dropIfCurrent();
      }, dropIfCurrent);

      return promise;
    },
    clearCache() {
      entries.clear();
    },
  };
}
