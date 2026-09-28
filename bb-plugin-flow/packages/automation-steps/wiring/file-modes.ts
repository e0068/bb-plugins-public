// Layer 3 (shell), the testable part — reads the executable files of the working copy from git
// through the GitPorts port; the parsing is core/file-modes.ts.
import { executablePaths, STAGE_ARGS } from "../core/file-modes";
import { gitRunMessage, type GitPorts } from "./git-run";

/**
 * Executable paths of the branch. A git failure throws instead of returning
 * an empty set: an empty set would silently open the PR with every
 * executable bit dropped — the very bug this read exists to prevent.
 */
export async function readExecutablePaths(git: GitPorts): Promise<ReadonlySet<string>> {
  const run = await git.run(STAGE_ARGS);
  if (run.code !== 0) throw new Error(`could not read file modes: ${gitRunMessage(run)}`);
  return executablePaths(run.stdout);
}
