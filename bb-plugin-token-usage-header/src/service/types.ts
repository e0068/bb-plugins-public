// Shapes used across the service layer. Depends on src/core for the report
// shape; server.ts / app.tsx should only ever need what's re-exported from
// src/service/index.ts, not these directly.
import type { TokensBy, TokensReport } from "../core";

/** Slice parameters accepted by `tools/tokens.py --json`. Mirrors its CLI flags 1:1. */
export interface TokensQueryParams {
  /** Defaults to "session" (tokens.py's own default) when omitted. */
  by?: TokensBy;
  /** Substring match on the project path, as tokens.py's `--project` does. */
  project?: string;
  /** Session id, or a prefix of one — tokens.py matches with `startswith`. */
  session?: string;
  /** ISO date, e.g. "2026-08-01". */
  since?: string;
  until?: string;
  /** Row cap before truncation; tokens.py defaults to 25. */
  top?: number;
}

export type TokensRunFailureReason =
  // `session` was an empty string rather than omitted/undefined. Passing it
  // through would silently drop the --session filter (tokens.py treats ""
  // the same as "no filter" too), turning a one-thread query into a global
  // sum across every project — never let that happen quietly.
  | "invalid_session"
  // Neither `python3` nor `python` resolved on PATH.
  | "python_not_found"
  // The process didn't finish within the configured timeout and was killed.
  | "timeout"
  // stdout grew past the configured cap and the process was killed.
  | "output_limit"
  // tokens.py's own top-level handler caught an exception and printed
  // `{"error": "..."}` — a recognized, well-formed failure from the script.
  | "script_error"
  // stdout parsed neither as the report shape nor as a script error object
  // (empty output, non-JSON garbage, valid JSON with the wrong shape).
  | "invalid_output"
  // The process could not be spawned/managed for a reason other than a
  // missing interpreter (e.g. EACCES).
  | "process_error";

export type TokensRunResult =
  | { ok: true; data: TokensReport }
  | { ok: false; reason: TokensRunFailureReason; message: string };
