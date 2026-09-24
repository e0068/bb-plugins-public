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

export function bbCliClient(env: BbCliEnv = process.env): CliPorts {
  const executable = bbExecutable(env);
  return {
    async run(args: readonly string[], callEnv?: Readonly<Record<string, string>>): Promise<CliRun> {
      try {
        const { stdout, stderr } = await run(executable, [...args], {
          timeout: 20000,
          ...(callEnv === undefined ? {} : { env: { ...process.env, ...callEnv } }),
        });
        return { kind: "ran", code: 0, stdout, stderr };
      } catch (error) {
        // execFile throws both when the process ran and exited non-zero (a
        // numeric `code`, with the streams attached) and when it never
        // started at all (`code` is a spawn errno like ENOENT, and there are
        // no streams to speak of). The two are different facts and stay so.
        const e = error as { code?: unknown; stdout?: string; stderr?: string };
        if (typeof e.code === "number") {
          return { kind: "ran", code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
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
