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
// docs/decisions/local-main-pull-targets-actual-checkout.md.
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
//
// One divergence is not a refusal: after a squash merge local `<base>` still
// carries the PR's own commits, while origin has them as one squash commit.
// So on a divergence the content is measured — merging local `<base>` into
// origin in memory (core/merged-content.ts) — and when that adds nothing, the
// local branch is put onto origin; any content origin lacks keeps the refusal
// and the commits. See docs/decisions/local-main-pull-resets-after-squash.md.
import { findBaseCheckout, parseWorktreeList } from "../core/git-worktrees";
import {
  baseTreeArgs,
  fastForwardAtArgs,
  fetchBaseArgs,
  fetchBaseAtArgs,
  fetchIntoLocalBranchArgs,
  mergeTreeArgs,
  moveBranchToOriginArgs,
  resetKeepAtArgs,
  worktreeListArgs,
} from "../core/git-commands";
import { describeMainPullFailure, isDivergedPull } from "../core/main-pull-reason";
import { decideMergedContent, type MergedContent } from "../core/merged-content";
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
  if (!isDiverged(fetched)) return toResult(fetched);
  // The refused refspec is not trusted to have refreshed origin/<base>.
  const refreshed = await ports.run(fetchBaseArgs(base));
  return refreshed.code === 0 ? moveIfAlreadyInOrigin(ports, base, fetched, moveBranchToOriginArgs(base)) : toResult(fetched);
}

async function pullAtCheckout(
  ports: GitPorts,
  path: string,
  base: string,
): Promise<LocalMainPullResult> {
  const fetched = await ports.run(fetchBaseAtArgs(path, base));
  if (fetched.code !== 0) return toResult(fetched);
  const merged = await ports.run(fastForwardAtArgs(path, base));
  return isDiverged(merged) ? moveIfAlreadyInOrigin(ports, base, merged, resetKeepAtArgs(path, base)) : toResult(merged);
}

function isDiverged(run: GitRun): boolean {
  return run.code !== 0 && isDivergedPull(gitRunMessage(run));
}

async function moveIfAlreadyInOrigin(
  ports: GitPorts,
  base: string,
  refusal: GitRun,
  move: readonly string[],
): Promise<LocalMainPullResult> {
  return (await localContentInOrigin(ports, base)) === "merged" ? toResult(await ports.run(move)) : toResult(refusal);
}

// Refs are shared by every worktree, so the measurement runs from anywhere.
// The full refs/heads/ name measures the very branch the move then touches,
// never a tag of the same name.
async function localContentInOrigin(ports: GitPorts, base: string): Promise<MergedContent> {
  const remote = `origin/${base}`;
  const mergeTree = await ports.run(mergeTreeArgs(remote, `refs/heads/${base}`));
  // A conflict or a git failure already answers; there is no tree to compare.
  if (mergeTree.code !== 0) return decideMergedContent({ mergeTree, baseTree: mergeTree });
  return decideMergedContent({ mergeTree, baseTree: await ports.run(baseTreeArgs(remote)) });
}

function toResult(run: GitRun): LocalMainPullResult {
  // A refusal is expected (diverged, busy, or uncommitted changes), not a
  // defect — describeMainPullFailure turns git's raw advice block into one
  // readable line and names which of those it was. See
  // docs/decisions/main-pull-reason-humanized.md.
  return run.code === 0
    ? { ok: true }
    : { ok: false, reason: describeMainPullFailure(gitRunMessage(run)) };
}
