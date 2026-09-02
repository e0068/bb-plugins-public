// Layer 3 — the single effect point for fast-forwarding: runs `git` in the
// working copy. Implements the GitPorts port without throwing on a non-zero
// code: the code and output go to the orchestrator (fast-forward.ts), which
// decides whether it's a success or a failure.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitPorts, GitRun } from "./git-run";

const run = promisify(execFile);

export function gitClient(cwd: string): GitPorts {
  return {
    async run(args: readonly string[]): Promise<GitRun> {
      try {
        const { stdout, stderr } = await run("git", [...args], { cwd, timeout: 20000 });
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
