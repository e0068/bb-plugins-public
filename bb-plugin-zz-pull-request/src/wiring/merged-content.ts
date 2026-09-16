// Layer 3 (shell) — measures the fact "the branch's content is already in the
// base" with git. The reading of that measurement is pure and lives in
// src/core/merged-content.ts; here there is only the sequence of runs.
//
// The fetch comes first and is not optional in base mode "origin": the
// plugin's own working copy keeps a stale `origin/<base>` for as long as
// nobody pulls it (bb doesn't, and the plugin only does after its own
// merge), and measuring against a stale ref answers "not merged" for content
// that landed long ago — exactly the ghost button this check exists to
// remove. Mode "local" measures against the working copy's own `<base>`
// ref directly, so there is nothing to fetch.
import type { ResolvedBase } from "../core/base-branch";
import { baseTreeArgs, fetchBaseArgs, mergeTreeArgs } from "../core/git-commands";
import { decideMergedContent, type MergedContent } from "../core/merged-content";
import type { GitPorts } from "./git-run";

export async function checkMergedContent(
  ports: GitPorts,
  base: ResolvedBase,
): Promise<MergedContent> {
  if (base.mode === "origin") {
    const fetched = await ports.run(fetchBaseArgs(base.githubBase));
    if (fetched.code !== 0) return "unknown";
  }

  const mergeTree = await ports.run(mergeTreeArgs(base.statusBase));
  // A conflict already answers the question, and `merge-tree` printed no
  // comparable tree — asking git for the base tree would buy nothing.
  if (mergeTree.code !== 0) return decideMergedContent({ mergeTree, baseTree: mergeTree });

  const baseTree = await ports.run(baseTreeArgs(base.statusBase));
  return decideMergedContent({ mergeTree, baseTree });
}
