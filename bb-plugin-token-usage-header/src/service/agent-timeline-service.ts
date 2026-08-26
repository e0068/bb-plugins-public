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
import { parseAgentTimeline, type AgentTimeline } from "../core/agent-timeline";
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
    ? `${parsed.message} (код завершения ${result.code}): ${diagnostic}`
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
          message: "Пустой session id недопустим.",
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
            message: `Превышен общий бюджет времени (${totalTimeoutMs}ms) до попытки запустить "${interpreter}"`,
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
          "Не найден интерпретатор Python (python3 или python) в PATH. Установите Python 3 и убедитесь, что команда python3 доступна.",
      };
    },
  };
}

/** Canonical cache key for a query — missing `agent` normalized to "main". */
function cacheKeyFor(params: AgentTimelineQueryParams): string {
  return JSON.stringify({ session: params.session, agent: params.agent ?? "main" });
}

const DEFAULT_CACHE_TTL_MS = 30_000;

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

      const promise = runner.run(params);
      const entry = { expiresAt: now() + ttlMs, promise };
      entries.set(key, entry);

      const dropIfCurrent = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      promise.catch(dropIfCurrent);
      // Отказ не кэшируем — та же причина, что в src/service/cache.ts: он
      // обычно про окружение (не найден python, недоступна сессия сейчас),
      // а не про данные, и не должен держать пользователя на устаревшей
      // ошибке весь TTL.
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
