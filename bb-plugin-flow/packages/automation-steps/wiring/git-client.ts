// Layer 3 — the single effect point for git: runs `git` in the working copy.
// Implements the GitPorts port without throwing on a non-zero code: the code
// and output go to the orchestrator (catch-up.ts, fast-forward.ts), which
// decides whether it's a success or a failure.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitPorts, GitRun } from "./git-run";

const run = promisify(execFile);

export function gitClient(cwd: string): GitPorts {
  return {
    async run(args: readonly string[]): Promise<GitRun> {
      try {
        // LC_ALL=C pins git's human messages to English so the plugin parses
        // and humanizes them regardless of the user's locale — main-pull-reason
        // keys on stable English phrases, not the localized "Быстрая перемотка
        // невозможна" a Russian locale would print. Porcelain data output
        // (worktree list, rev-parse) is locale-independent to begin with.
        const env = { ...process.env, LC_ALL: "C" };
        const { stdout, stderr } = await run("git", [...args], { cwd, timeout: 20000, env });
        return { code: 0, stdout, stderr };
      } catch (error) {
        // execFile throws on a non-zero exit; the code and streams are on the error.
        const e = error as { code?: unknown; stdout?: string; stderr?: string };
        return {
          code: typeof e.code === "number" ? e.code : 1,
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? String(error),
        };
      }
    },
  };
}
