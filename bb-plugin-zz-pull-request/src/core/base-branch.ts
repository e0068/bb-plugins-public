// Layer 1 — resolves the environment's base branch. Zero effects.
//
// The base is needed in two forms, and they must not be confused:
// - statusBase — what to compute merge-base and aheadCount against. By
//   default (mode "origin") this is the REMOTE branch `origin/<x>`, the same
//   way the bb panel itself does: the local `main` in a worktree can be stale
//   (behind origin/main), and comparing against it produces phantom "commits
//   ahead", with the button staying visible even at a zero diff. Mode
//   "local" is the escape hatch for that same tradeoff read the other way —
//   it compares against whatever `main` already is in the working copy, no
//   fetch, no dependency on origin being reachable or up to date.
// - githubBase — the bare branch name for the GitHub API (getBranch) and the
//   pull request's base field; an `origin/` prefix isn't allowed there, and
//   it never depends on the mode.
//
// Environment fields come in three forms with different meanings:
// mergeBaseBranch (explicit base override, a name), defaultBranch (the
// default branch name), baseBranch (sometimes a remote ref like `origin/main`).

/** Which ref `statusBase` resolves to — see the module doc above. One shared choice per thread. */
export type BaseMode = "origin" | "local";

/** The mode every environment starts in, and the one the original (pre-toggle) behavior always was. */
export const DEFAULT_BASE_MODE: BaseMode = "origin";

export function isBaseMode(value: unknown): value is BaseMode {
  return value === "origin" || value === "local";
}

export interface EnvBranches {
  mergeBaseBranch: string | null;
  defaultBranch: string | null;
  baseBranch: string | null;
}

export interface ResolvedBase {
  /** The mode this base was resolved under — lets a caller skip a fetch step for "local". */
  mode: BaseMode;
  /** Remote ref (mode "origin") or local ref (mode "local") for merge-base/aheadCount. */
  statusBase: string;
  /** Bare branch name for the GitHub API and the pull request's base. Mode-independent. */
  githubBase: string;
}

export function resolveBase(env: EnvBranches, mode: BaseMode): ResolvedBase | null {
  const raw = env.mergeBaseBranch ?? env.defaultBranch ?? env.baseBranch;
  if (!raw) return null;
  const githubBase = stripOriginPrefix(raw);
  const statusBase = mode === "local" ? githubBase : `origin/${githubBase}`;
  return { mode, statusBase, githubBase };
}

/** `origin/main` → `main`; other names are left alone (a branch name may itself contain "/"). */
function stripOriginPrefix(branch: string): string {
  return branch.startsWith("origin/") ? branch.slice("origin/".length) : branch;
}
