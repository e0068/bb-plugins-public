import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Repo-relative paths an active worktree environment has actually changed
 * relative to its own merge base — committed and uncommitted together
 * (`target: "all"`). This is what filesync/merge.ts uses to tell "this
 * environment touched this task file" apart from "this environment's full
 * checkout happens to differ from main", which is true at every path it
 * *hasn't* touched the moment main moves past that environment's branch
 * point.
 *
 * A renamed file contributes both its new and previous path, since a task's
 * scanned `filePath` (its current status folder) is what needs to match.
 *
 * Never throws: falls back to an empty set — "this environment changed
 * nothing" — whenever it has no merge base to diff against, isn't a git
 * worktree, or the call otherwise fails. An empty set means the worktree
 * contributes no overrides this sync, which is the safe default when we
 * can't tell what it changed; the alternative (treating everything as
 * changed) is exactly the bug this function exists to avoid.
 */
export async function changedFilePaths(
  bb: BbPluginApi,
  environmentId: string,
): Promise<ReadonlySet<string>> {
  try {
    const environment = await bb.sdk.environments.get({ environmentId });
    if (environment.mergeBaseBranch === null) return new Set();

    const diff = await bb.sdk.environments.diffFiles({
      environmentId,
      target: "all",
      mergeBaseBranch: environment.mergeBaseBranch,
    });
    if (diff.outcome !== "available") return new Set();

    const paths = new Set<string>();
    for (const file of diff.files) {
      paths.add(file.path);
      if (file.previousPath !== null) paths.add(file.previousPath);
    }
    return paths;
  } catch {
    return new Set();
  }
}
