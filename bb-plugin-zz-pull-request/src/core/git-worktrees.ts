// Layer 1 — parses `git worktree list --porcelain` and finds which worktree
// currently has the base branch checked out. Zero effects.
//
// The porcelain format is blocks of lines per worktree, separated by a blank
// line: `worktree <path>`, `HEAD <sha>`, then either `branch <ref>` (a
// regular branch) or `detached`/`bare` (no branch). Only the path↔branch
// pair is needed.

export interface GitWorktree {
  path: string;
  /** `null` — detached HEAD, a bare repository, or undeterminable. */
  branch: string | null;
}

const WORKTREE_PREFIX = "worktree ";
const BRANCH_PREFIX = "branch ";
const BRANCH_REF_PREFIX = "refs/heads/";

export function parseWorktreeList(output: string): readonly GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (path !== null) worktrees.push({ path, branch });
    path = null;
    branch = null;
  };
  for (const line of output.split("\n")) {
    if (line === "") {
      flush();
    } else if (line.startsWith(WORKTREE_PREFIX)) {
      path = line.slice(WORKTREE_PREFIX.length);
    } else if (line.startsWith(BRANCH_PREFIX)) {
      branch = line.slice(BRANCH_PREFIX.length);
    }
  }
  flush();
  return worktrees;
}

/** The worktree path where `<base>` is currently checked out, or `null` if nowhere. */
export function findBaseCheckout(
  worktrees: readonly GitWorktree[],
  base: string,
): string | null {
  const target = `${BRANCH_REF_PREFIX}${base}`;
  return worktrees.find((worktree) => worktree.branch === target)?.path ?? null;
}
