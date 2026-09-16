// Layer 3 (shell), the testable part — the order in which the button's
// visibility gets decided. The decisions themselves are pure
// (src/core/visibility.ts, src/core/merged-content.ts); the effects are
// behind ports, so this order is verified without git, KV or the network.
//
// The order exists to keep the check cheap. `decideVisibility` answers from
// data bb has already fetched; only a "ready" answer is worth measuring the
// content for, and a HEAD already known to be merged skips even that. So the
// expensive step (a `git fetch` plus a merge) runs once per new HEAD, not on
// every poll.
import {
  decideVisibility,
  refineWithMergedContent,
  type PrPresence,
  type VisibilityDecision,
} from "../core/visibility";
import { measureContentCached, type ContentCachePorts } from "./content-cache";

/** The slice of `environments.status().workspace` the decision actually reads. */
export interface VisibilityWorkspace {
  headSha: string | null;
  hasUncommittedChanges: boolean;
  aheadCount: number;
}

/** The measure-once-per-HEAD protocol, shared with the "Done & Archive" button. */
export type VisibilityPorts = ContentCachePorts;

export async function resolveVisibility(
  ports: VisibilityPorts,
  input: { workspace: VisibilityWorkspace; pr: PrPresence },
): Promise<VisibilityDecision> {
  const { workspace, pr } = input;
  const decision = decideVisibility({
    hasUncommittedChanges: workspace.hasUncommittedChanges,
    aheadCount: workspace.aheadCount,
    pr,
  });
  if (!decision.visible) return decision;
  return refineWithMergedContent(
    decision,
    await measureContentCached(ports, workspace.headSha),
  );
}
