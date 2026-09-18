// Layer 1 — decides whether to show the "Fast Forward" button (catch up with
// the base branch). Zero effects.
//
// Fast-forwarding is needed exactly when the branch CAN be fast-forwarded
// without a merge: it's behind the base (behind > 0) and has no commits of
// its own ahead (ahead = 0). Commits ahead mean divergence — that's a
// merge/rebase situation, not a fast-forward, so the button is hidden.
// Uncommitted changes also hide it: an ff-merge on a dirty tree runs into
// uncommitted work.

export interface FastForwardInput {
  behindCount: number;
  aheadCount: number;
  hasUncommittedChanges: boolean;
}

/** The reason is exposed outward — the front end can use it to hint the user. */
export type FastForwardReason = "ready" | "up-to-date" | "diverged" | "dirty";

export interface FastForwardDecision {
  visible: boolean;
  reason: FastForwardReason;
}

export function decideFastForward(input: FastForwardInput): FastForwardDecision {
  // Dirty tree — the ff-merge would run into uncommitted work; commit first.
  if (input.hasUncommittedChanges) return { visible: false, reason: "dirty" };
  // Not behind — nothing to fast-forward.
  if (input.behindCount <= 0) return { visible: false, reason: "up-to-date" };
  // Commits ahead of our own — branches diverged, a clean fast-forward is impossible.
  if (input.aheadCount > 0) return { visible: false, reason: "diverged" };
  return { visible: true, reason: "ready" };
}
