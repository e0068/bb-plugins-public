// Layer 3 — the single effect point for the `bb` CLI: runs it and returns
// its outcome. Implements CliPorts without throwing — neither on a non-zero
// code nor on a failure to spawn; same shape and reasoning as
// git-client.ts's GitPorts.
//
// Which file to spawn is decided by src/core/bb-cli-path.ts from the
// environment, NOT by a bare `bb` looked up on PATH: the bb server process
// this code runs in does not have the CLI's directory on its PATH, so the
// bare name resolves to nothing. The environment is taken as an argument so
// the decision stays testable and the process global is read in exactly one
// place.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bbExecutable, type BbCliEnv } from "../core/bb-cli-path";
import type { CliPorts, CliRun } from "./bb-cli-run";

const run = promisify(execFile);

/**
 * How long a call may run. A `bb tasks` write lands in the thread's tree and
 * can wait behind bb's own commit lock: BBPL-931's `update --status done` did
 * not fit in 20 s, and the step reported a bare "Command failed".
 */
export const BB_CLI_TIMEOUT_MS = 60_000;

export function bbCliClient(env: BbCliEnv = process.env, timeoutMs = BB_CLI_TIMEOUT_MS): CliPorts {
  const executable = bbExecutable(env);
  return {
    async run(args: readonly string[], callEnv?: Readonly<Record<string, string>>): Promise<CliRun> {
      try {
        const { stdout, stderr } = await run(executable, [...args], {
          timeout: timeoutMs,
          ...(callEnv === undefined ? {} : { env: { ...process.env, ...callEnv } }),
        });
        return { kind: "ran", code: 0, stdout, stderr };
      } catch (error) {
        // execFile throws when the process ran and exited non-zero (a numeric
        // `code`, with the streams attached), when the timeout killed it
        // (`killed`, no code), and when it never started at all (`code` is a
        // spawn errno like ENOENT). Three different facts, and they stay so.
        const e = error as { code?: unknown; killed?: unknown; stdout?: string; stderr?: string };
        if (typeof e.code === "number") {
          return { kind: "ran", code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
        }
        if (e.killed === true) {
          return { kind: "unavailable", reason: `bb did not answer within ${timeoutMs / 1000} s: ${[executable, ...args].join(" ")}` };
        }
        return { kind: "unavailable", reason: messageOf(error, executable) };
      }
    },
  };
}

function messageOf(error: unknown, executable: string): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(executable) ? text : `${text} (${executable})`;
}
