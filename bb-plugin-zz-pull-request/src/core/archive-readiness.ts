// Layer 1 — decides whether to show the "Done & Archive" thread-header button.
// Zero effects.
//
// Archiving only makes sense once the branch's work has actually landed and
// there is nothing pending that archiving could bury. So the decision reads
// exactly two facts, and each of them can come back UNMEASURED — that third
// variant is the point of this module. bb refuses to answer about an
// environment that is not `ready` (its `status`/`pullRequest` routes go
// through `requireReadyEnvironment` and throw), and git can fail too; the
// shell then has no fact, not a negative one.
//
// The two unknowns are deliberately NOT symmetric:
//
//   - an unknown LANDING hides the button. Visibility rests on positive
//     evidence that the work is in the base; silence is not evidence, and
//     archiving on a guess would mark the thread's linked task done for work
//     that may still be un-landed.
//   - an unknown WORKING TREE still shows the button, flagged. The landing is
//     already proven at that point, so the remaining risk is burying an
//     uncommitted scratch edit — and hiding the only way out of a retiring
//     thread over an unmeasurable maybe is worse than saying so out loud.
//
// See memory/decisions/archive-visible-on-positive-landing-evidence.md.

import type { WorkingTree } from "./working-tree";

/** Is the branch's work in the base? `unknown` = nobody could measure it. */
export type Landing = "landed" | "not-merged" | "unknown" | "unlanded-commits";

export interface ArchiveReadinessInput {
  landing: Landing;
  workingTree: WorkingTree;
}

// The reason travels out through the `archiveState` RPC, where the shell adds
// two causes of its own — see ArchiveStateReason in server.ts.
export type ArchiveReason =
  | "already-archived"
  | "dirty"
  | "landing-unknown"
  | "not-merged"
  | "ready"
  | "tree-unverified"
  | "unlanded-commits";

export interface ArchiveReadinessDecision {
  visible: boolean;
  reason: ArchiveReason;
}

export function decideArchiveVisible({
  landing,
  workingTree,
}: ArchiveReadinessInput): ArchiveReadinessDecision {
  switch (landing) {
    // Nothing is in the base yet — a live PR, a PR closed without merging, or
    // no PR at all. This is also exactly when bb core's "Merge" / the plugin's
    // "Pull Request" button is showing, so Archive stays out of their way.
    case "not-merged":
      return { visible: false, reason: "not-merged" };
    // The branch landed and then grew new commits — the "Pull Request" button
    // is back; don't show Archive next to it and bury them.
    case "unlanded-commits":
      return { visible: false, reason: "unlanded-commits" };
    case "unknown":
      return { visible: false, reason: "landing-unknown" };
    case "landed":
      return decideOnWorkingTree(workingTree);
  }
}

/**
 * What the button decision reads. A sum, not a record with an `archived`
 * flag beside the facts: on an archived thread the work's facts are never
 * measured (the shell short-circuits before touching git or GitHub), so a
 * shape that demanded them would force the caller to invent them.
 */
export type ArchiveButtonInput =
  | { archived: true }
  | { archived: false; readiness: ArchiveReadinessInput };

/**
 * The whole button decision: an archived thread first, the work's readiness
 * otherwise. Archiving is idempotent and bb already shows its own "Thread is
 * archived / Unarchive" bar there, so no state of the work can put the button
 * back — which is why this is a gate in front of {@link decideArchiveVisible}
 * rather than another `landing` variant inside it.
 */
export function decideArchiveButton(input: ArchiveButtonInput): ArchiveReadinessDecision {
  return input.archived
    ? { visible: false, reason: "already-archived" }
    : decideArchiveVisible(input.readiness);
}

function decideOnWorkingTree(workingTree: WorkingTree): ArchiveReadinessDecision {
  switch (workingTree) {
    case "dirty":
      return { visible: false, reason: "dirty" };
    case "unknown":
      return { visible: true, reason: "tree-unverified" };
    case "clean":
      return { visible: true, reason: "ready" };
  }
}
