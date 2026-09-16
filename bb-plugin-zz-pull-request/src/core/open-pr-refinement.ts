// Layer 1 — refines the host's cached PR signal with a direct GitHub
// measurement. Zero effects.
//
// The host stops polling GitHub once it decides a thread's PR is merged —
// its own SDK doc comment says so: "an open PR with pending checks
// refreshes, a merged one does not". A new PR opened on the same branch
// afterwards (the normal flow once a settled PR lets the "Pull Request"
// button reappear, see visibility.ts) never reaches the host's signal again.
// See memory/decisions/open-pr-bypass-host-terminal-signal.md.
import type { OpenPullRequest } from "./github-requests";
import type { ChecksState, Mergeability, PrState } from "./merge-readiness";
import type { PrPresence } from "./visibility";

/** The same shape the shell reads off the host and feeds into decideVisibility/decideMergeReadiness. */
export interface PrSignal {
  presence: PrPresence;
  url: string | null;
  number: number | null;
  state: PrState | null;
  checksState: ChecksState | null;
  mergeability: Mergeability | null;
}

/**
 * `open` is trusted as-is — the host is already right, asking GitHub again
 * would only repeat its own answer. Anywhere else (`absent`/`settled`/
 * `unknown`), a found live PR overrides the whole signal to that PR; finding
 * nothing never downgrades what the host said. Checks and mergeability for a
 * freshly-found PR are deliberately left `unknown` rather than guessed — a
 * lighter first cut than also teaching this plugin GitHub's Checks API (see
 * the decision record for the rejected fuller alternative). The "Merge"
 * button still renders for it, just with the `unknown` indicator until the
 * host's own signal catches up with the real checks state.
 */
export function refineWithLiveOpenPr(host: PrSignal, found: OpenPullRequest | null): PrSignal {
  if (host.presence === "open" || !found) return host;
  return {
    presence: "open",
    url: found.url,
    number: found.number,
    state: "open",
    checksState: "unknown",
    mergeability: "unknown",
  };
}
