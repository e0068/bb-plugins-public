// Adapter around node:child_process — the one place in this plugin that
// actually spawns a process. Kept behind the `ProcessRunner` function type so
// callers (src/service/tokens-runner.ts) can inject a fake in unit tests and
// never touch a real interpreter.
import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Caps stdout/stderr buffering so a runaway or malicious process can't blow up plugin memory. */
export const DEFAULT_MAX_OUTPUT_BYTES = 20 * 1024 * 1024; // 20MB

export type ProcessFailureReason =
  // ENOENT: the command itself isn't on PATH.
  | "not_found"
  // Killed after exceeding the timeout.
  | "timeout"
  // Killed after stdout exceeded the byte cap.
  | "output_limit"
  // Any other spawn/runtime error (e.g. EACCES).
  | "spawn_error";

export type ProcessRunResult =
  | { ok: true; stdout: string; stderr: string; code: number | null }
  | { ok: false; reason: ProcessFailureReason; message: string };

export interface ProcessRunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * Runs `command args` and resolves with a tagged result — never rejects.
 * stdout/stderr are always returned as full text regardless of exit code;
 * callers decide what a non-zero code means (tokens.py's own JSON error
 * envelope is what tells us that, not the exit code).
 */
export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessRunOptions,
) => Promise<ProcessRunResult>;

export const runProcess: ProcessRunner = (command, args, options = {}) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve) => {
    let settled = false;
    // `timer` is assigned right below, before `spawn()` runs — settle()
    // must never be reachable while `timer` is still in its TDZ. The old
    // ordering called spawn() first, so a synchronous throw from spawn()
    // (e.g. a NUL byte in `command`) — if caught and routed through
    // settle() — would hit `clearTimeout(timer)` before `timer` existed.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({
        ok: false,
        reason: "timeout",
        message: `"${command}" timed out after ${timeoutMs}ms and was killed`,
      });
    }, timeoutMs);
    const settle = (result: ProcessRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // spawn() can throw synchronously (not just emit an async 'error'
    // event) for malformed input like a NUL byte in `command`/`args`. The
    // documented contract of this function is "never rejects" — without
    // this try/catch, that throw would escape the executor and reject the
    // returned promise instead.
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      settle({
        ok: false,
        reason: "spawn_error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        settle({
          ok: false,
          reason: "output_limit",
          message: `"${command}" stdout exceeded ${maxOutputBytes} bytes and was killed`,
        });
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      // stderr is only surfaced for diagnostics on failure, never parsed,
      // so a runaway process doesn't need to be killed over it the way
      // stdout does — but it's still capped to the same bound so a chatty
      // process can't buffer unboundedly in plugin memory. Once at the
      // cap, further stderr is silently dropped instead of killing the
      // process (it may still finish successfully on stdout).
      if (stderrBytes >= maxOutputBytes) return;
      const remaining = maxOutputBytes - stderrBytes;
      const kept = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        settle({ ok: false, reason: "not_found", message: `"${command}" not found in PATH` });
      } else {
        settle({ ok: false, reason: "spawn_error", message: err.message });
      }
    });

    child.on("close", (code) => {
      settle({
        ok: true,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        code,
      });
    });
  });
};
