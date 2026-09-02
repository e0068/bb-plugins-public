// Layer 3 (shell) — measures the fact "the branch's content is already in the
// base" with git. The reading of that measurement is pure and lives in
// src/core/merged-content.ts; here there is only the sequence of runs.
//
// The fetch comes first and is not optional: the plugin's own working copy
// keeps a stale `origin/<base>` for as long as nobody pulls it (bb doesn't,
// and the plugin only does after its own merge), and measuring against a
// stale ref answers "not merged" for content that landed long ago — exactly
// the ghost button this check exists to remove.
import { baseTreeArgs, fetchBaseArgs, mergeTreeArgs } from "../core/git-commands";
import { decideMergedContent, type MergedContent } from "../core/merged-content";
import type { GitPorts } from "./git-run";

export async function checkMergedContent(
  ports: GitPorts,
  base: string,
): Promise<MergedContent> {
  const fetched = await ports.run(fetchBaseArgs(base));
  if (fetched.code !== 0) return "unknown";

  const mergeTree = await ports.run(mergeTreeArgs(base));
  // A conflict already answers the question, and `merge-tree` printed no
  // comparable tree — asking git for the base tree would buy nothing.
  if (mergeTree.code !== 0) return decideMergedContent({ mergeTree, baseTree: mergeTree });

  const baseTree = await ports.run(baseTreeArgs(base));
  return decideMergedContent({ mergeTree, baseTree });
}
