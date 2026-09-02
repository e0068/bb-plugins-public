// Layer 1 — resolves the environment's base branch. Zero effects.
//
// The base is needed in two forms, and they must not be confused:
// - statusBase — what to compute merge-base and aheadCount against. We use
//   the REMOTE branch `origin/<x>`, the same way the bb panel itself does.
//   The local `main` in a worktree can be stale (behind origin/main):
//   comparing against it produces phantom "commits ahead", and the button
//   stays visible even at a zero diff.
// - githubBase — the bare branch name for the GitHub API (getBranch) and the
//   pull request's base field; an `origin/` prefix isn't allowed there.
//
// Environment fields come in three forms with different meanings:
// mergeBaseBranch (explicit base override, a name), defaultBranch (the
// default branch name), baseBranch (sometimes a remote ref like `origin/main`).

export interface EnvBranches {
  mergeBaseBranch: string | null;
  defaultBranch: string | null;
  baseBranch: string | null;
}

export interface ResolvedBase {
  /** Remote ref for merge-base/aheadCount — the way bb itself computes it. */
  statusBase: string;
  /** Bare branch name for the GitHub API and the pull request's base. */
  githubBase: string;
}

export function resolveBase(env: EnvBranches): ResolvedBase | null {
  const raw = env.mergeBaseBranch ?? env.defaultBranch ?? env.baseBranch;
  if (!raw) return null;
  const githubBase = stripOriginPrefix(raw);
  const statusBase = raw.startsWith("origin/") ? raw : `origin/${githubBase}`;
  return { statusBase, githubBase };
}

/** `origin/main` → `main`; other names are left alone (a branch name may itself contain "/"). */
function stripOriginPrefix(branch: string): string {
  return branch.startsWith("origin/") ? branch.slice("origin/".length) : branch;
}
