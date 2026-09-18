// Layer 3 (shell), the testable part — the live `ahead` count of the branch
// against its base for the Fast Forward button's visibility (server.ts in
// Automations): fetch in mode "origin", then `rev-list --count`. The step that
// actually moves the branch is catch-up.ts. The real `run` is git-client.ts.
import type { ResolvedBase } from "../core/base-branch";
import { aheadCountArgs, fetchBaseArgs } from "../core/git-commands";
import type { GitPorts } from "./git-run";

export type { GitPorts, GitRun } from "./git-run";

async function countAhead(ports: GitPorts, ref: string): Promise<number | null> {
  const counted = await ports.run(aheadCountArgs(ref));
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
// (mode "origin" only — a stale local `origin/<base>` would lie the same way
// checkMergedContent avoids in merged-content.ts), then count live. `null`
// when it can't be measured (network hiccup): the caller falls back to the
// cached count rather than hiding the button on a shrug.
export async function liveAheadCount(ports: GitPorts, base: ResolvedBase): Promise<number | null> {
  if (base.mode === "origin") {
    const fetched = await ports.run(fetchBaseArgs(base.githubBase));
    if (fetched.code !== 0) return null;
  }
  return countAhead(ports, base.statusBase);
}
