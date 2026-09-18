// Layer 3 (shell) — the network effect for the live open-PR lookup. Reuses
// the same GithubRequest→GithubResponse port create-pr.ts already defines
// (send to the GitHub REST API); the request and its parsing are pure and
// live in core/github-requests.ts.
import {
  listOpenPullRequestsRequest,
  parseOpenPullRequest,
  type OpenPullRequest,
  type RepoRef,
} from "../core/github-requests";
import type { CreatePrPorts } from "./create-pr";

export async function findLiveOpenPr(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  baseBranch: string,
): Promise<OpenPullRequest | null> {
  const res = await ports.send(listOpenPullRequestsRequest(repo, headBranch, baseBranch));
  return res.status === 200 ? parseOpenPullRequest(res.data) : null;
}
