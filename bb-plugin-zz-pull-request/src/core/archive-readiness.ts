// Layer 1 — decides whether to show the "Archive" thread-header button. Zero effects.
//
// Archiving only makes sense once the branch's work has actually landed and
// there is nothing pending that archiving could bury. That means Archive is
// the complement of the two action buttons: it never shows alongside "Pull
// Request" (committed work not yet in a PR) or "Merge" (a live PR waiting to
// be merged). Concretely, all of these must be false — no uncommitted changes,
// no committed changes that aren't landed yet, no live PR (open/draft) — and
// the branch's own PR must be merged.

import type { PrState } from "./merge-readiness";

export interface ArchiveReadinessInput {
  prState: PrState | null;
  hasUncommittedChanges: boolean;
  /**
   * Committed work ahead of the base that isn't landed yet — the same fact the
   * "Pull Request" button lives on. While it's true a new PR can still be
   * opened, so Archive must stay hidden rather than bury those commits.
   */
  hasUnlandedCommits: boolean;
}

/** The reason is exposed outward — the front end can use it to hint the user. */
export type ArchiveReason = "ready" | "not-merged" | "dirty" | "unlanded-commits";

export interface ArchiveReadinessDecision {
  visible: boolean;
  reason: ArchiveReason;
}

export function decideArchiveVisible(input: ArchiveReadinessInput): ArchiveReadinessDecision {
  // Only a merged PR counts as "landed" — closed-without-merging and any
  // live state (open/draft) leave work that isn't actually in main yet. A live
  // PR is also exactly when the "Merge" button shows, so this keeps the two apart.
  if (input.prState !== "merged") return { visible: false, reason: "not-merged" };
  if (input.hasUncommittedChanges) return { visible: false, reason: "dirty" };
  // New commits landed after the merge — the "Pull Request" button is showing;
  // don't show Archive next to it.
  if (input.hasUnlandedCommits) return { visible: false, reason: "unlanded-commits" };
  return { visible: true, reason: "ready" };
}
