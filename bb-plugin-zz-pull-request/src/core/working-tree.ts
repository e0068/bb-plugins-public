// Layer 1 — reads git's answer to "is there uncommitted work in this copy?".
// Zero effects.
//
// `git status --porcelain` prints one line per changed path and nothing at
// all for a clean tree, so the verdict is simply "was anything printed".
// Untracked files (`??`) count as dirty on purpose: archiving would bury them
// exactly like a modified tracked file would.
//
// This exists because bb's own `environments.status` — which normally supplies
// `hasUncommittedChanges` — refuses to answer for an environment that is not
// `ready`. On a retiring one the working copy is still on disk, so git can be
// asked directly.
import type { CommandOutcome } from "./command-outcome";

/** Is there uncommitted work archiving would bury? `unknown` = git gave no answer. */
export type WorkingTree = "clean" | "dirty" | "unknown";

/** `git status --porcelain` — one line per changed path, nothing when clean. */
export function workingTreeStatusArgs(): readonly string[] {
  return ["status", "--porcelain"];
}

export function decideWorkingTree({ code, stdout }: CommandOutcome): WorkingTree {
  // A failed run is not a clean tree. Reading it as one would hand the button
  // a "nothing to lose" it never measured.
  if (code !== 0) return "unknown";
  return stdout.trim() === "" ? "clean" : "dirty";
}
