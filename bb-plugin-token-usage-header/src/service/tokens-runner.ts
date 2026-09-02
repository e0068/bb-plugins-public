// Runs tools/tokens.py --json and turns whatever it produces into a typed
// result. This is the only module that knows the script's path and CLI
// contract; src/core does the actual output parsing.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTokensOutput } from "../core";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  runProcess,
  type ProcessRunner,
  type ProcessRunResult,
} from "./process-runner";
import type { TokensQueryParams, TokensRunResult } from "./types";

/** Interpreters tried in order; whichever works first is remembered. */
const INTERPRETER_CANDIDATES = ["python3", "python"] as const;
type Interpreter = (typeof INTERPRETER_CANDIDATES)[number];

/** How many ancestor directories to check before giving up. */
const MAX_ROOT_SEARCH_DEPTH = 6;

/**
 * Walks up from `startDir` looking for a directory that has `tools/tokens.py`
 * directly under it — that directory is the plugin root. Depth-bounded
 * instead of counting a fixed number of ".." segments, because the same
 * module lives at a different depth depending on install shape:
 * `<plugin>/src/service/tokens-runner.ts` in a source checkout,
 * `<plugin>/dist/server.js` once `bb plugin build` inlines it. Exported for
 * unit testing with a fake `exists` — no real filesystem needed there.
 */
export function resolvePluginRoot(
  startDir: string,
  exists: (path: string) => boolean = existsSync,
  maxDepth: number = MAX_ROOT_SEARCH_DEPTH,
): string | null {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    if (exists(join(dir, "tools", "tokens.py"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Resolves tools/tokens.py from this module's own location, not the
 * process's cwd — bb runs plugin server code from its own working
 * directory, so `process.cwd()` does not point at the plugin's install dir.
 *
 * Searches for the plugin root rather than assuming a fixed number of
 * directory levels: `bb plugin build` inlines this module into a
 * self-contained `dist/server.js`, one level above the plugin root instead
 * of the two levels a source-layout `src/service/tokens-runner.ts` sits at.
 * A fixed `../../` breaks the built install by escaping the plugin
 * directory entirely.
 */
export function defaultScriptPath(): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  const root = resolvePluginRoot(startDir) ?? join(startDir, "..", "..");
  return join(root, "tools", "tokens.py");
}

function buildArgs(scriptPath: string, params: TokensQueryParams): string[] {
  const args = [scriptPath, "--json"];
  if (params.by) args.push("--by", params.by);
  if (params.project) args.push("--project", params.project);
  if (params.session) args.push("--session", params.session);
  if (params.since) args.push("--since", params.since);
  if (params.until) args.push("--until", params.until);
  if (params.top !== undefined) args.push("--top", String(params.top));
  return args;
}

function mapProcessFailure(result: Extract<ProcessRunResult, { ok: false }>): TokensRunResult {
  const reason = result.reason === "not_found" ? "python_not_found" : result.reason === "spawn_error" ? "process_error" : result.reason;
  return { ok: false, reason, message: result.message };
}

// Parses stdout on its own, but on failure also folds in stderr/exit code —
// the process runner reports `ok: true` for ANY exit code as long as it got
// to `close` (see process-runner.ts), so a script that dies before printing
// a single byte (missing tools/tokens.py, a Python-level ImportError, a
// permission error) reaches here as bare empty stdout. Without this, that
// surfaces to the user as an undiagnosable "empty output" with no hint of
// what actually went wrong, even though the real reason was sitting in
// stderr the whole time.
function mapStdout(result: Extract<ProcessRunResult, { ok: true }>): TokensRunResult {
  const parsed = parseTokensOutput(result.stdout);
  if (parsed.ok) return { ok: true, data: parsed.data };
  // tokens.py's own {"error": ...} envelope already explains itself (it's
  // `str(exception)` from its top-level handler) — folding stderr into that
  // would only add noise on top of an already-diagnosed failure. Only the
  // "invalid_output" case (stdout was empty/garbage/wrong-shaped, i.e. the
  // script never got to explain itself) is missing a diagnosis to begin with.
  if (parsed.reason === "script_error") {
    return { ok: false, reason: "script_error", message: parsed.message };
  }
  const diagnostic = result.stderr.trim();
  const message = diagnostic
    ? `${parsed.message} (exit code ${result.code}): ${diagnostic}`
    : parsed.message;
  return { ok: false, reason: "invalid_output", message };
}

export interface TokensRunnerOptions {
  /** Defaults to the real `node:child_process`-backed runner. */
  processRunner?: ProcessRunner;
  scriptPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface TokensRunner {
  run(params: TokensQueryParams): Promise<TokensRunResult>;
}

/**
 * Builds a runner that finds a Python interpreter, invokes tools/tokens.py
 * with the given slice params, and parses the result. Never throws — every
 * failure mode (missing interpreter, timeout, oversized output, malformed
 * output, tokens.py's own error envelope) comes back as a tagged result.
 */
export function createTokensRunner(options: TokensRunnerOptions = {}): TokensRunner {
  const processRunner = options.processRunner ?? runProcess;
  const scriptPath = options.scriptPath ?? defaultScriptPath();
  const totalTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  // Remembered across calls so a found interpreter isn't re-searched for
  // every query. Cleared only when the cached one stops working.
  let cachedInterpreter: Interpreter | null = null;

  return {
    async run(params) {
      // An empty string is not "no session" (that's `undefined`) — passing
      // it through would drop --session from the args below (falsy check)
      // and tokens.py treats a missing/empty --session the same way: no
      // filter at all. A single thread's counter would then silently show
      // the sum across every project. Fail loudly instead.
      if (params.session === "") {
        return {
          ok: false,
          reason: "invalid_session",
          message: "An empty session id is not allowed: this isn't the absence of a session, but a lost filter on one.",
        };
      }

      const args = buildArgs(scriptPath, params);
      const order: readonly Interpreter[] = cachedInterpreter
        ? [cachedInterpreter, ...INTERPRETER_CANDIDATES.filter((c) => c !== cachedInterpreter)]
        : INTERPRETER_CANDIDATES;

      // One deadline shared across every interpreter attempt in this call —
      // without it, a full timeoutMs per attempt lets python3-then-python
      // fallback take up to len(INTERPRETER_CANDIDATES)x the configured
      // budget in the worst case (e.g. 60s instead of 30s).
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
