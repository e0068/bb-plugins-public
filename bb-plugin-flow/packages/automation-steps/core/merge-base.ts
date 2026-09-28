// Layer 1 — reads the merge-base sha out of bb's status. Zero effects.
//
// `workspace.mergeBase.baseRef` is the resolved merge-base commit — the very
// point `mergeBase.files` were diffed against, in the same response. It is
// the only right source for the PR commit's parent: measuring the merge-base
// again with a separate `git merge-base` would be a second reading of the
// same value, equal to the first only "usually".

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The merge-base commit sha, or `null` when bb gave none or something that
 * isn't a full sha (a branch name, a short sha) — that would travel to
 * GitHub as a commit id in a URL, so it is refused rather than passed on.
 */
export function parseMergeBaseRef(baseRef: string | null): string | null {
  return baseRef !== null && FULL_SHA.test(baseRef) ? baseRef : null;
}
