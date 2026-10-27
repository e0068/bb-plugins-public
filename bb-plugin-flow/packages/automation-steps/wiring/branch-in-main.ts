// Layer 2 (wiring) — measures the fact "the thread's code is already in the
// base" with git: the sequence of runs. The reading of each answer is pure and
// lives in core/branch-in-main.ts, core/merged-content.ts and core/stamped-conflict.ts.
//
// The fetch comes first in base mode "origin", for the reason given in
// ./merged-content.ts: a stale `origin/<base>` answers "not in" for code that
// landed long ago. The content check then reuses that fetch.
import type { ResolvedBase } from "../core/base-branch";
import { decideAncestry, headInBaseArgs, type BranchInMain } from "../core/branch-in-main";
import { baseTreeArgs, fetchBaseArgs } from "../core/git-commands";
import { decideMergedContent } from "../core/merged-content";
import { decideStampedConflict, mergeTreeNamesArgs, parseMergeConflict, treeDiffArgs } from "../core/stamped-conflict";
import type { GitPorts } from "./git-run";

export async function checkBranchInMain(ports: GitPorts, base: ResolvedBase): Promise<BranchInMain> {
  if (base.mode === "origin") {
    const fetched = await ports.run(fetchBaseArgs(base.githubBase));
    if (fetched.code !== 0) return "unknown";
  }

  switch (decideAncestry(await ports.run(headInBaseArgs(base.statusBase)))) {
    case "ancestor":
      return "in-main";
    case "unknown":
      return "unknown";
    case "not-ancestor":
      return checkContent(ports, base.statusBase);
  }
}

/**
 * The content check of core/merged-content.ts, with one difference: a conflict
 * that leaves only the stamped changelog entry or task file in play is read
 * further instead of as "not merged" (core/stamped-conflict.ts).
 */
async function checkContent(ports: GitPorts, ref: string): Promise<BranchInMain> {
  const mergeTree = await ports.run(mergeTreeNamesArgs(ref));
  if (mergeTree.code === 1) return checkStampedConflict(ports, ref, mergeTree.stdout);
  if (mergeTree.code !== 0) return "unknown";

  const content = decideMergedContent({ mergeTree, baseTree: await ports.run(baseTreeArgs(ref)) });
  return content === "merged" ? "in-main" : content === "not-merged" ? "not-in-main" : "unknown";
}

async function checkStampedConflict(ports: GitPorts, ref: string, stdout: string): Promise<BranchInMain> {
  const { tree, paths } = parseMergeConflict(stdout);
  if (tree === "") return "unknown";

  const diff = await ports.run(treeDiffArgs(ref, tree));
  if (diff.code !== 0) return "unknown";

  const differing = diff.stdout.split("\n").filter((path) => path !== "");
  return decideStampedConflict({ paths, differing }) ? "in-main" : "not-in-main";
}
