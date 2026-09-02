// Layer 3 (shell) — best-effort update of the local `main` after a PR merge.
//
// `<base>` is almost always checked out SOMEWHERE in the shared repository —
// usually in the integration copy, separate from the environment's working
// copy (env.path) that the plugin itself runs in (see AGENTS.md, "Parallel
// sessions"). A direct `git fetch origin <base>:<base>` from env.path runs
// into that: git correctly REFUSES to update a branch checked out in another
// worktree — but previously the plugin just stopped there, even though the
// branch CAN still be updated: with a regular `fetch`+`merge --ff-only` run
// DIRECTLY in that working copy (`git -C <path> ...`) — the same thing a
// human would do by hand. See
// memory/decisions/local-main-pull-targets-actual-checkout.md.
//
// So first we ask `git worktree list --porcelain` (cheap, read-only, doesn't
// matter where it's run from — worktrees are shared across the whole
// repository) and look for which worktree currently has `<base>` checked out:
// - found → `fetch`+`merge --ff-only` right there (`-C <path>`);
// - not checked out anywhere → the old direct path, `fetch origin <base>:<base>`.
// In both cases `--ff-only`/a refspec with no `+` prevent a non-fast-forward
// update — a guarantee from git, not from the plugin. A refusal is an
// expected, ordinary outcome (diverged, or uncommitted changes in the target
// copy), not a defect: the result is a Result, not a throw.
import { findBaseCheckout, parseWorktreeList } from "../core/git-worktrees";
import {
  fastForwardAtArgs,
  fetchBaseAtArgs,
  fetchIntoLocalBranchArgs,
  worktreeListArgs,
} from "../core/git-commands";
import { gitRunMessage, type GitPorts, type GitRun } from "./git-run";

export type LocalMainPullResult = { ok: true } | { ok: false; reason: string };

export async function runLocalMainPull(
  ports: GitPorts,
  base: string,
): Promise<LocalMainPullResult> {
  const checkoutPath = await findBaseCheckoutPath(ports, base);
  return checkoutPath
    ? pullAtCheckout(ports, checkoutPath, base)
    : pullDirectlyIntoRef(ports, base);
}

async function findBaseCheckoutPath(ports: GitPorts, base: string): Promise<string | null> {
  const listed = await ports.run(worktreeListArgs());
  if (listed.code !== 0) return null;
  return findBaseCheckout(parseWorktreeList(listed.stdout), base);
}

async function pullDirectlyIntoRef(ports: GitPorts, base: string): Promise<LocalMainPullResult> {
  const fetched = await ports.run(fetchIntoLocalBranchArgs(base));
  return toResult(fetched);
}

async function pullAtCheckout(
  ports: GitPorts,
  path: string,
  base: string,
): Promise<LocalMainPullResult> {
  const fetched = await ports.run(fetchBaseAtArgs(path, base));
  if (fetched.code !== 0) return toResult(fetched);
  const merged = await ports.run(fastForwardAtArgs(path, base));
  return toResult(merged);
}

function toResult(run: GitRun): LocalMainPullResult {
  return run.code === 0 ? { ok: true } : { ok: false, reason: gitRunMessage(run) };
}
