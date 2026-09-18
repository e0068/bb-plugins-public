// Layer 1 — how to catch a branch up with the tip of its base. Zero effects.
//
// The step pulls in the CURRENT tip of the base the branch was forked from and
// its PR targets: the fork point itself is already in the branch, merging it
// would change nothing. A branch that isn't behind has nothing to do, even
// with commits of its own. Behind with no commits of its own — a plain
// fast-forward. Behind with commits of its own — a regular merge of the base
// into the branch: history isn't rewritten, so an open PR stays intact.
// Uncommitted tracked changes or an unfinished merge refuse up front: a merge
// would run into them, and aborting would throw away someone else's merge.

export type CatchUpInput = { behind: number; ahead: number; dirty: boolean };

export type CatchUpAction = "dirty" | "up-to-date" | "fast-forward" | "merge";

export const decideCatchUp = ({ behind, ahead, dirty }: CatchUpInput): CatchUpAction =>
  dirty ? "dirty" : behind === 0 ? "up-to-date" : ahead === 0 ? "fast-forward" : "merge";

/** `git status --porcelain --untracked-files=no` — tracked changes only: untracked files don't block a merge. */
export const trackedChangesArgs = (): readonly string[] => ["status", "--porcelain", "--untracked-files=no"];

/** `git rev-parse -q --verify MERGE_HEAD` — code 0 while a merge is in progress in the tree. */
export const mergeInProgressArgs = (): readonly string[] => ["rev-parse", "-q", "--verify", "MERGE_HEAD"];

/** `git merge --no-edit <ref>` — merge the base into the branch with git's default message. */
export const mergeBaseArgs = (ref: string): readonly string[] => ["merge", "--no-edit", ref];

/** `git diff --name-only --diff-filter=U` — files left unmerged by a conflicted merge. */
export const conflictedFilesArgs = (): readonly string[] => ["diff", "--name-only", "--diff-filter=U"];

/** `git merge --abort` — put the branch and the tree back as they were before the merge. */
export const mergeAbortArgs = (): readonly string[] => ["merge", "--abort"];
