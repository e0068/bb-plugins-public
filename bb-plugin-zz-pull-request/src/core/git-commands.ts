// Layer 1 — pure argv builders for the fast-forward git commands. Zero effects.
//
// Fast-forwarding to a remote base is three steps: update the remote ref
// (`fetch`), live re-check `ahead` (`aheadCountArgs`), and only then move the
// current branch strictly forward (`merge --ff-only`). `--ff-only` is the
// safety guarantee: if it isn't a fast-forward (branches diverged), git
// refuses instead of merging with a commit; the live check exists to refuse
// with the plugin's own readable text before raw git does — see
// memory/tasks/in_progress/fast-forward-stale-ahead-status.md. Only the
// command bodies live here; running them and their cwd are in the shell.

/** `git fetch origin <base>` — pull a fresh `origin/<base>` before the fast-forward. */
export function fetchBaseArgs(base: string): readonly string[] {
  return ["fetch", "origin", base];
}

/** `git rev-list --count origin/<base>..HEAD` — live commits of the branch ahead of the base. */
export function aheadCountArgs(base: string): readonly string[] {
  return ["rev-list", "--count", `origin/${base}..HEAD`];
}

/** `git merge --ff-only origin/<base>` — move the branch forward to the base or refuse. */
export function fastForwardArgs(base: string): readonly string[] {
  return ["merge", "--ff-only", `origin/${base}`];
}

// `<src>:<dst>` with no leading `+` is a refspec that git ITSELF refuses to
// apply non-fast-forward, and refuses to update a branch checked out in any
// worktree of the repository. Only fits when `<base>` isn't checked out
// anywhere — otherwise see fetchBaseAtArgs/fastForwardAtArgs below (see
// memory/decisions/local-main-pull-targets-actual-checkout.md).
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
  return ["-C", path, ...fastForwardArgs(base)];
}

// The pair below answers "is the branch's content already in the base?" (see
// merged-content.ts). `merge-tree` merges without touching the working copy
// and prints the resulting tree; `rev-parse <base>^{tree}` gives the base's
// own tree to compare it against. Note that `--write-tree` DOES write the
// resulting tree objects into the object database — they are unreachable and
// get collected by gc, and the working copy is never touched, but this is not
// a read-only command.
/** `git merge-tree --write-tree origin/<base> HEAD` — merge in memory, print the resulting tree. */
export function mergeTreeArgs(base: string): readonly string[] {
  return ["merge-tree", "--write-tree", `origin/${base}`, "HEAD"];
}

/** `git rev-parse origin/<base>^{tree}` — the base's own tree, to compare the merge result against. */
export function baseTreeArgs(base: string): readonly string[] {
  return ["rev-parse", `origin/${base}^{tree}`];
}
