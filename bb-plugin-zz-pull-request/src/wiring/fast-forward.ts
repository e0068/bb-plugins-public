// Layer 3 (shell), the testable part — orchestrates fast-forwarding the
// branch to the base.
//
// The sequence (fetch → live re-check of ahead → merge --ff-only) and the
// parsing of exit codes live here and are verified with a fake `run`, no
// real git. The actual `run` (spawning the process) is in git-client.ts, the
// single effect point.
//
// Between the moment the front end decides to show the button and the click
// on it, the caller (server.ts) already relied on `sdk.environments.status` —
// a bb cache that can be slow to pick up a fresh commit (see
// memory/tasks/in_progress/fast-forward-stale-ahead-status.md). `--ff-only`
// is safe on its own and simply refuses on divergence, but with raw git
// text. So right after `fetch` (once `origin/<base>` is already fresh) we
// count `ahead` live ourselves — and if it's positive, we refuse with the
// plugin's own readable text before git gets the chance to.
import { aheadCountArgs, fastForwardArgs, fetchBaseArgs } from "../core/git-commands";
import { gitRunMessage, type GitPorts, type GitRun } from "./git-run";

export type { GitPorts, GitRun };

export async function runFastForward(ports: GitPorts, base: string): Promise<void> {
  const fetched = await ports.run(fetchBaseArgs(base));
  if (fetched.code !== 0) {
    throw new Error(`git fetch origin ${base}: ${gitRunMessage(fetched)}`);
  }
  if (await hasLiveAheadCommits(ports, base)) {
    throw new Error("Fast-forward is not possible right now (diverged).");
  }
  const merged = await ports.run(fastForwardArgs(base));
  if (merged.code !== 0) {
    throw new Error(`could not fast-forward to origin/${base}: ${gitRunMessage(merged)}`);
  }
}

// A non-zero exit code or non-numeric output does not block the
// fast-forward: `--ff-only` is safe on its own; the live check only exists
// to refuse earlier and more clearly in an already-diverged case, not as the
// sole line of defense.
async function hasLiveAheadCommits(ports: GitPorts, base: string): Promise<boolean> {
  const count = await countAhead(ports, base);
  return count !== null && count > 0;
}

async function countAhead(ports: GitPorts, base: string): Promise<number | null> {
  const counted = await ports.run(aheadCountArgs(base));
  if (counted.code !== 0) return null;
  const count = Number.parseInt(counted.stdout.trim(), 10);
  return Number.isInteger(count) ? count : null;
}

// The button's visibility (server.ts computeFastForwardState) must not trust
// `sdk.environments.status`'s cached aheadCount: that cache can sit stale at
// 0 well past the run of a thread's own commits, showing "ready" for a
// branch that has in fact already diverged — every click then dies with
// "diverged" and the button never fixes itself (see
// memory/tasks/in_progress/fast-forward-stale-ahead-status.md). Fetch first
// — a stale local `origin/<base>` would lie the same way checkMergedContent
// avoids (merged-content.ts) — then count live. `null` when it can't be
// measured (network hiccup): the caller falls back to the cached count
// rather than hiding the button on a shrug.
export async function liveAheadCount(ports: GitPorts, base: string): Promise<number | null> {
  const fetched = await ports.run(fetchBaseArgs(base));
  if (fetched.code !== 0) return null;
  return countAhead(ports, base);
}
