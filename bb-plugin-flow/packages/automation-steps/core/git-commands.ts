// Layer 1 — pure argv builders for the git commands that measure and move the
// branch against its base. Zero effects.
//
// Catching up with a remote base (wiring/catch-up.ts) updates the remote ref
// (`fetch`), counts `behind`/`ahead` live, and then either moves the branch
// strictly forward (`merge --ff-only`) or merges the base in — the merge
// command itself is in core/catch-up.ts. Live counts, not the bb status cache,
// see docs/tasks/in_progress/fast-forward-stale-ahead-status.md. Only the
// command bodies live here; running them and their cwd are in the shell.
//
// `aheadCountArgs`/`fastForwardArgs`/`mergeTreeArgs`/`baseTreeArgs` take the
// base ref already fully resolved (`origin/<x>` or the bare local `<x>`) —
// they no longer decide the `origin/` prefix themselves. That decision is
// the base-mode toggle's (see src/core/base-branch.ts's `ResolvedBase.mode`);
// the callers that always mean the remote (fastForwardAtArgs, below) spell
// `origin/<x>` out explicitly instead.

/** `git fetch origin <base>` — pull a fresh `origin/<base>` before the fast-forward. */
export function fetchBaseArgs(base: string): readonly string[] {
  return ["fetch", "origin", base];
}

/** `git rev-list --count <ref>..HEAD` — live commits of the branch ahead of the base ref. */
export function aheadCountArgs(ref: string): readonly string[] {
  return ["rev-list", "--count", `${ref}..HEAD`];
}

/** `git rev-list --count HEAD..<ref>` — live commits of the base the branch doesn't have yet. */
export function behindCountArgs(ref: string): readonly string[] {
  return ["rev-list", "--count", `HEAD..${ref}`];
}

/** `git merge --ff-only <ref>` — move the branch forward to the base ref or refuse. */
export function fastForwardArgs(ref: string): readonly string[] {
  return ["merge", "--ff-only", ref];
}

// `<src>:<dst>` with no leading `+` is a refspec that git ITSELF refuses to
// apply non-fast-forward, and refuses to update a branch checked out in any
// worktree of the repository. Only fits when `<base>` isn't checked out
// anywhere — otherwise see fetchBaseAtArgs/fastForwardAtArgs below (see
// docs/decisions/local-main-pull-targets-actual-checkout.md).
/** `git fetch origin <base>:<base>` — pull origin/<base> straight into the local ref `<base>`. */
export function fetchIntoLocalBranchArgs(base: string): readonly string[] {
  return ["fetch", "origin", `${base}:${base}`];
}

/** `git worktree list --porcelain` — list all worktrees of the shared repository. */
export function worktreeListArgs(): readonly string[] {
  return ["worktree", "list", "--porcelain"];
}

// `-C <path>` makes git run the command as if that were its cwd — it doesn't
// matter where the process was actually spawned from. This way `<base>` gets
// updated by a regular `fetch` + `merge --ff-only` DIRECTLY in the working
// copy where it's checked out (usually the integration copy, see AGENTS.md),
// rather than being moved from outside, where git forbids that.
/** `git -C <path> fetch origin <base>` — pull origin/<base> in the given worktree. */
export function fetchBaseAtArgs(path: string, base: string): readonly string[] {
  return ["-C", path, ...fetchBaseArgs(base)];
}

/** `git -C <path> merge --ff-only origin/<base>` — fast-forward the branch checked out in `<path>`. */
export function fastForwardAtArgs(path: string, base: string): readonly string[] {
  return ["-C", path, ...fastForwardArgs(`origin/${base}`)];
}

// The pair below answers "is the branch's content already in the base?" (see
// merged-content.ts). `merge-tree` merges without touching the working copy
// and prints the resulting tree; `rev-parse <base>^{tree}` gives the base's
// own tree to compare it against. Note that `--write-tree` DOES write the
// resulting tree objects into the object database — they are unreachable and
// get collected by gc, and the working copy is never touched, but this is not
// a read-only command.
/** `git merge-tree --write-tree <ref> <commit>` — merge in memory, print the resulting tree. The commit defaults to HEAD; the cutoff search asks the same question of the branch's earlier commits. */
export function mergeTreeArgs(ref: string, commit = "HEAD"): readonly string[] {
  return ["merge-tree", "--write-tree", ref, commit];
}

/** `git rev-list <ref>..HEAD` — the branch's own commits, newest first. */
export function ownCommitsArgs(ref: string): readonly string[] {
  return ["rev-list", `${ref}..HEAD`];
}

/** `git rebase --onto <ref> <cutoff>` — replay onto the base only what the branch has after the cutoff. */
export function replayOntoArgs(ref: string, cutoff: string): readonly string[] {
  return ["rebase", "--onto", ref, cutoff];
}

/** `git rebase --abort` — put the branch and the tree back as they were before the replay. */
export function replayAbortArgs(): readonly string[] {
  return ["rebase", "--abort"];
}

/** `git rev-parse HEAD` — the current commit of the working copy. Local, no network. */
export function headShaArgs(): readonly string[] {
  return ["rev-parse", "HEAD"];
}

/** `git rev-parse <ref>^{tree}` — the base ref's own tree, to compare the merge result against. */
export function baseTreeArgs(ref: string): readonly string[] {
  return ["rev-parse", `${ref}^{tree}`];
}
