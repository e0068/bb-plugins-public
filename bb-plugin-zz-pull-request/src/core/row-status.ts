// Layer 1 — pure core for the sidebar thread-row status glyph. Zero effects.
//
// From a thread's observed facts (git phase, raw PR facts, whether the agent
// is working, whether a merged glyph was already seen) it decides the single
// glyph the row shows, or none. The shell (server RPC + content script) reads
// those facts from the world — both git phase and PR facts come from the
// plugin's own `rowFacts` RPC, the same GitHub data the Merge button already
// computes (see `merge-readiness.ts`) — and calls
// `experimental_setThreadRowStatus` with the result; all the branching lives
// here so it can be tested as input→output.
import type { MergedContent } from "./merged-content";
import type { ChecksState, Mergeability, PrState } from "./merge-readiness";

/** Where the branch stands before any pull request exists. */
export type GitPhase = "uncommitted" | "committed" | "clean" | "unknown";

/**
 * The four live-work counters a sidebar thread carries. All zero means nothing
 * is running (SDK: `PluginSidebarThreadActivity`).
 */
export interface ThreadActivity {
  workflows: number;
  backgroundAgents: number;
  backgroundCommands: number;
  planMode: number;
  goals: number;
}

/**
 * The pull request narrowed to what a row needs — the same raw GitHub facts
 * `lookupPullRequest` already returns for the Merge button, so the row-status
 * RPC can hand them over verbatim instead of rolling up its own "attention".
 */
export interface PrSignal {
  state: PrState;
  checksState: ChecksState;
  mergeability: Mergeability;
}

/** Everything the row-state decision reads about one thread. */
export interface RowFacts {
  gitPhase: GitPhase;
  /** The thread's pull request, or null when it has none. */
  pr: PrSignal | null;
  /** The agent is actively working in this thread. */
  agentWorking: boolean;
  /** A merged glyph for this thread was already seen (dismissed on visit). */
  mergedSeen: boolean;
}

/**
 * The glyph the row shows. A closed sum so every branch of the mapping below is
 * checked for exhaustiveness. `none` means "clear the plugin's glyph".
 */
export type RowState =
  | { kind: "none" }
  | { kind: "uncommitted"; busy: boolean }
  | { kind: "committed"; busy: boolean }
  | { kind: "pr-open" }
  | { kind: "pr-checking" }
  | { kind: "pr-conflict" }
  | { kind: "pr-reviewed" }
  | { kind: "pr-merged" };

/** Host status payload (SDK: PluginComposerThreadRowStatus). */
export interface RowStatus {
  icon: string;
  label: string;
  tone: "default" | "error" | "running" | "success";
}

/**
 * Dirty tree beats "ahead" beats clean; concrete facts only (no effects).
 *
 * "Ahead" alone cannot mean "something is left to merge": PRs are opened
 * through the API without a push and merged by squash, so a branch whose
 * content landed stays `aheadCount > 0` forever, and the glyph sat on finished
 * threads claiming "committed changes". `mergedContent` (the measurement the
 * PR button hides itself by) tells the two apart. Only a positive answer
 * clears the glyph — `unknown` means git could not measure, and silence is no
 * proof that anything landed.
 */
export function decideGitPhase(input: {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  mergedContent: MergedContent;
}): GitPhase {
  if (input.hasUncommittedChanges) return "uncommitted";
  if (input.aheadCount === 0) return "clean";
  return input.mergedContent === "merged" ? "clean" : "committed";
}

/** Any live counter, or a running indicator, means the agent is working. */
export function isAgentWorking(activity: ThreadActivity): boolean {
  return (
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0
  );
}

/**
 * A pull request only decides the glyph while it is live and unseen:
 *   - merged & already seen → falls through to the git phase (glyph gone,
 *     unless new commits piled up);
 *   - closed-but-not-merged → falls through too (a closed PR is like none;
 *     a fresh commit can open a new one).
 * Otherwise, for a live (open or draft) PR: a git conflict outranks checks
 * (mirrors `decideMergeReadiness` — GitHub refuses the merge regardless of
 * checks), passing checks read as reviewed, pending checks read as checking,
 * and everything else (draft, failing/no-checks/unknown checks) is a plain
 * open PR.
 */
export function livePrState(pr: PrSignal, mergedSeen: boolean): RowState | null {
  if (pr.state === "merged") return mergedSeen ? null : { kind: "pr-merged" };
  if (pr.state === "closed") return null;
  if (pr.state === "draft") return { kind: "pr-open" };
  if (pr.mergeability === "conflicting") return { kind: "pr-conflict" };
  switch (pr.checksState) {
    case "passing":
      return { kind: "pr-reviewed" };
    case "pending":
      return { kind: "pr-checking" };
    case "failing":
    case "no_checks":
    case "unknown":
      return { kind: "pr-open" };
  }
}

/** The full precedence: a live PR outranks the pre-PR git phase. */
export function decideRowState(facts: RowFacts): RowState {
  if (facts.pr) {
    const fromPr = livePrState(facts.pr, facts.mergedSeen);
    if (fromPr) return fromPr;
  }
  switch (facts.gitPhase) {
    case "uncommitted":
      return { kind: "uncommitted", busy: facts.agentWorking };
    case "committed":
      return { kind: "committed", busy: facts.agentWorking };
    case "clean":
    case "unknown":
      return { kind: "none" };
  }
}

// Host icon-name hints. An unrecognized name silently falls back to a
// generic bolt ("Zap") — verified live against bb's own icon registries
// (index-riEiWomc.js: the eager core set `An` plus the lazy-loaded extended
// set `Cn`). Neither has a git-commit-graph icon at all, so `uncommitted`/
// `committed` use the closest available names rather than the originally
// guessed "CircleDot"/"GitCommitHorizontal" — both confirmed live to render
// as Zap (see memory/decisions/row-status-rpc-not-frontend-hooks.md).
export const ICON = {
  uncommitted: "Circle",
  committed: "GitBranch",
  prOpen: "GitPullRequest",
  prChecking: "GitPullRequest",
  prConflict: "GitPullRequestClosed",
  prReviewed: "GitPullRequestArrow",
  prMerged: "GitMerge",
} as const;

// The accessible label of each glyph — and, because the host renders it as
// the icon's `aria-label`, the handle the sidebar CSS override hangs on to
// find this plugin's own glyph among any others in the same slot (see
// src/core/row-glyph-css.ts). Kept here, beside the icon names, so the two
// can't drift apart.
export const LABEL = {
  uncommitted: "Uncommitted changes",
  committed: "Committed changes",
  prOpen: "Pull request open",
  prChecking: "Pull request checks running",
  prConflict: "Pull request has conflicts",
  prReviewed: "Pull request reviewed",
  prMerged: "Pull request merged",
} as const;

/** Maps a row state to the host status payload, or null to clear the glyph. */
export function rowStateToStatus(state: RowState): RowStatus | null {
  switch (state.kind) {
    case "none":
      return null;
    case "uncommitted":
      return {
        icon: ICON.uncommitted,
        label: LABEL.uncommitted,
        tone: state.busy ? "running" : "default",
      };
    case "committed":
      return {
        icon: ICON.committed,
        label: LABEL.committed,
        tone: state.busy ? "running" : "default",
      };
    case "pr-open":
      return { icon: ICON.prOpen, label: LABEL.prOpen, tone: "default" };
    case "pr-checking":
      return { icon: ICON.prChecking, label: LABEL.prChecking, tone: "running" };
    case "pr-conflict":
      return { icon: ICON.prConflict, label: LABEL.prConflict, tone: "error" };
    case "pr-reviewed":
      return { icon: ICON.prReviewed, label: LABEL.prReviewed, tone: "success" };
    case "pr-merged":
      return { icon: ICON.prMerged, label: LABEL.prMerged, tone: "success" };
  }
}

/** The one call the shell makes: facts → glyph payload or null. */
export function decideRowStatus(facts: RowFacts): RowStatus | null {
  return rowStateToStatus(decideRowState(facts));
}

/**
 * While a PR/Merge/Archive operation is in flight on the thread, whatever glyph
 * the row shows pulses: the host draws tone `"running"` with `animate-pulse`
 * (bb bundle, the `MY` status renderer), so forcing that tone is all it takes.
 * A cleared glyph (`null`) stays cleared — there is nothing to pulse — and a
 * glyph already `"running"` is returned untouched so the shell's change
 * detection doesn't re-push an identical status.
 *
 * The tone it overrides (error on a conflict, success on a merge) is the right
 * thing to lose here: an operation is actively touching the branch, and "being
 * worked on right now" outranks the settled colour until it finishes.
 */
export function withOpRunning(status: RowStatus | null, opRunning: boolean): RowStatus | null {
  if (!opRunning || status === null || status.tone === "running") return status;
  return { ...status, tone: "running" };
}
