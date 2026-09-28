// Layer 3 (shell) — waits for GitHub's verdict on a PR whose head just moved.
//
// bb's own `environments.pullRequest` is a cache. Right after the plugin
// rewrote the PR's head (caught it up with main, committed a version bump)
// that cache still answered "mergeable" from before the rewrite, and a merge
// fired on that answer came back "HTTP 409: Pull request is not currently
// mergeable" — GitHub was still computing. So the verdict is asked of GitHub
// itself, through the same REST port the bump already uses.
import {
  getPullRequestRequest,
  parsePullMergeability,
  type RepoRef,
} from "../core/github-requests";
import type { Mergeability } from "../core/merge-readiness";
import type { CreatePrPorts } from "./create-pr";

export const MERGEABILITY_POLL_MS = 1000;
export const MERGEABILITY_TIMEOUT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls once a second until `mergeable` is true or false — both are
 * verdicts; a conflict will be refused by the merge itself with a proper
 * message. A failed request is read as "no answer yet", not as a reason to
 * stop. After the timeout returns `unknown`: the caller merges anyway, so
 * that bb's own error — not a guess of ours — is what gets reported.
 */
export async function waitForMergeability(
  ports: CreatePrPorts,
  repo: RepoRef,
  number: number,
): Promise<Mergeability> {
  const deadline = Date.now() + MERGEABILITY_TIMEOUT_MS;
  for (;;) {
    const res = await ports.send(getPullRequestRequest(repo, number));
    const verdict = res.status === 200 ? parsePullMergeability(res.data) : "unknown";
    if (verdict !== "unknown") return verdict;
    if (Date.now() >= deadline) return "unknown";
    await sleep(MERGEABILITY_POLL_MS);
  }
}
