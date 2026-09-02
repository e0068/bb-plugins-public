// Layer 1 — decides whether to show the "Merge" button and which checks
// indicator to render on it. Zero effects.
//
// The "Merge" button mirrors the "Pull Request" button: that one lives while
// the PR is not yet open (see visibility.ts); this one lives from the moment
// an open PR appears until it's merged or closed. Visible exactly for a live
// (not draft, not closed, not merged) PR.

/** `checks.state` from the GitHub response via bb: the PR's aggregated checks status. */
export type ChecksState = "failing" | "no_checks" | "passing" | "pending" | "unknown";

/** `pullRequest.state` from the bb response. */
export type PrState = "closed" | "draft" | "merged" | "open";

export interface MergeReadinessInput {
  prState: PrState;
  checksState: ChecksState;
}

/** What to render on the button — the icon shape matching the aggregated checks status. */
export type MergeIndicator = "success" | "failure" | "pending" | "neutral" | "unknown";

export interface MergeReadinessDecision {
  visible: boolean;
  indicator: MergeIndicator;
}

export function decideMergeReadiness(input: MergeReadinessInput): MergeReadinessDecision {
  // Only a live, non-draft PR can be merged — draft and settled PRs hide the
  // button, mirroring how the "Pull Request" button hides for them on its side.
  if (input.prState !== "open") return { visible: false, indicator: "unknown" };
  return { visible: true, indicator: mergeIndicator(input.checksState) };
}

function mergeIndicator(state: ChecksState): MergeIndicator {
  switch (state) {
    case "passing":
      return "success";
    case "failing":
      return "failure";
    case "pending":
      return "pending";
    case "no_checks":
      return "neutral";
    case "unknown":
      return "unknown";
  }
}
