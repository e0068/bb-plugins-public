// Layer 1 — decides whether to show the "Archive" thread-header button. Zero effects.
//
// Archiving only makes sense once the branch's work has actually landed
// (the PR is merged, not just closed) and there's nothing uncommitted left
// that archiving could bury — mirrors how Fast Forward and Pull Request gate
// on the same two kinds of facts (PR state, working tree) from other angles.

import type { PrState } from "./merge-readiness";

export interface ArchiveReadinessInput {
  prState: PrState | null;
  hasUncommittedChanges: boolean;
}

/** The reason is exposed outward — the front end can use it to hint the user. */
export type ArchiveReason = "ready" | "not-merged" | "dirty";

export interface ArchiveReadinessDecision {
  visible: boolean;
  reason: ArchiveReason;
}

export function decideArchiveVisible(input: ArchiveReadinessInput): ArchiveReadinessDecision {
  // Only a merged PR counts as "landed" — closed-without-merging and any
  // live state (open/draft) leave work that isn't actually in main yet.
  if (input.prState !== "merged") return { visible: false, reason: "not-merged" };
  if (input.hasUncommittedChanges) return { visible: false, reason: "dirty" };
  return { visible: true, reason: "ready" };
}
