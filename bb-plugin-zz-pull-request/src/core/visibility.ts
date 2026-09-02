// Layer 1 — decides whether to show the "Pull Request" button. Zero effects.
//
// The button is needed in exactly one state: everything is committed, there
// are commits ahead of the base branch, and there is no OPEN PR for this
// branch yet. Any other state hides the button — its only role is "create".
//
// A settled PR (merged/closed) does NOT block the button: after a merge and
// a new commit the branch is once again ahead of the base, and a new PR can
// be opened for that commit. Only a live (open/draft) PR blocks it — to
// avoid spawning duplicates.
//
// The decision comes in two steps on purpose. `decideVisibility` answers from
// data bb already has at hand; only when it says "ready" is it worth paying
// for the content check, whose answer `refineWithMergedContent` folds in. See
// merged-content.ts for why the content — and not SHAs — is what gets checked.

/**
 * What bb knows about this branch's PR:
 * - `absent` — an actual "no PR" answer;
 * - `open` — there's an unclosed PR (open/draft) → blocks the button;
 * - `settled` — the PR was merged or closed → does NOT block the button, a new one can be opened;
 * - `unknown` — couldn't find out (no gh/auth/timeout) → blocks the button,
 *   creating one blindly is not allowed, or we risk opening a second PR.
 */
export type PrPresence = "absent" | "open" | "settled" | "unknown";

export interface VisibilityInput {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  pr: PrPresence;
}

/** The reason is exposed outward — the front end can use it to hint the user. */
export type VisibilityReason =
  | "ready"
  | "dirty"
  | "already-merged"
  | "nothing-to-pr"
  | "pr-exists"
  | "pr-unknown";

export interface VisibilityDecision {
  visible: boolean;
  reason: VisibilityReason;
}

export function decideVisibility(input: VisibilityInput): VisibilityDecision {
  // A live PR is already open — no button (don't spawn duplicates).
  if (input.pr === "open") return { visible: false, reason: "pr-exists" };
  // Couldn't find out about the PR — creating one blindly is not allowed; hide it.
  if (input.pr === "unknown") return { visible: false, reason: "pr-unknown" };
  // absent | settled — a PR can be opened; changes and commits decide the rest.
  // There are uncommitted changes — commit first (bb core's Commit button).
  if (input.hasUncommittedChanges) return { visible: false, reason: "dirty" };
  // Nothing to PR — the branch hasn't moved ahead of the base.
  if (input.aheadCount <= 0) return { visible: false, reason: "nothing-to-pr" };
  return { visible: true, reason: "ready" };
}

/**
 * The last word: even a "ready" branch has nothing to PR when its content is
 * already in the base. That happens after ANY kind of merge — the plugin's
 * own squash, bb's native button, a merge on github.com — because all of them
 * land the content under a different SHA, leaving `aheadCount` above zero
 * forever. Refining can only hide, never reveal: a decision that hides for
 * its own reason keeps that reason.
 */
export function refineWithMergedContent(
  decision: VisibilityDecision,
  alreadyMerged: boolean,
): VisibilityDecision {
  if (!decision.visible || !alreadyMerged) return decision;
  return { visible: false, reason: "already-merged" };
}
