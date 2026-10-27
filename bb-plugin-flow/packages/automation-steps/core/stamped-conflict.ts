// Layer 1 — reads the one conflict that does not mean "the code is not in the
// base": the changelog entry (or the task file) the base stamped differently
// from the branch's copy. Zero effects.
//
// The step Bump puts the version and the date into the PR's head on GitHub
// only, so the thread's own branch keeps `version: coming-soon` while the base
// carries the stamped file. After a squash `merge-tree` reports add/add on
// that file — a conflict, and by core/merged-content.ts a conflict reads "not
// merged". When the files in conflict are all of that class (core/conflict-merge.ts
// settles them on its own) and the merged tree differs from the base in nothing
// else, the branch's code is in.
import { conflictClass } from "./conflict-merge";

/** `git merge-tree --write-tree --name-only <ref> HEAD` — the merged tree, then the files left in conflict. */
export function mergeTreeNamesArgs(ref: string): readonly string[] {
  return ["merge-tree", "--write-tree", "--name-only", ref, "HEAD"];
}

/** `git diff --name-only <ref> <tree>` — the files in which the merged tree differs from the base. */
export function treeDiffArgs(ref: string, tree: string): readonly string[] {
  return ["diff", "--name-only", ref, tree];
}

export interface MergeConflict {
  readonly tree: string;
  readonly paths: readonly string[];
}

/** The tree on the first line and the paths up to the first blank line; the messages after it are skipped. */
export function parseMergeConflict(stdout: string): MergeConflict {
  const [tree = "", ...rest] = stdout.split("\n");
  const blank = rest.indexOf("");
  return { tree: tree.trim(), paths: (blank < 0 ? rest : rest.slice(0, blank)).filter((path) => path !== "") };
}

/** True when every file in conflict is a changelog entry or a task file, and the merged tree differs from the base in those files alone. */
export function decideStampedConflict(input: { paths: readonly string[]; differing: readonly string[] }): boolean {
  const { paths, differing } = input;
  return paths.length > 0 && paths.every((path) => conflictClass(path) !== "other") && differing.every((path) => paths.includes(path));
}
