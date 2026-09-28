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

/**
 * Ответ GitHub целиком: `asked: false` — спросить не вышло, и это не то же
 * самое, что «открытого PR нет». Шаг открытия PR на этой разнице стоит: на
 * «нет» он открывает новый, на «не спросили» — верит кэшу хоста, потому что
 * второй PR дороже отчёта чужим адресом.
 */
export type OpenPrAnswer = { asked: true; pr: OpenPullRequest | null } | { asked: false };

export async function askLiveOpenPr(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  baseBranch: string,
): Promise<OpenPrAnswer> {
  const res = await ports.send(listOpenPullRequestsRequest(repo, headBranch, baseBranch));
  return res.status === 200 ? { asked: true, pr: parseOpenPullRequest(res.data) } : { asked: false };
}

export async function findLiveOpenPr(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  baseBranch: string,
): Promise<OpenPullRequest | null> {
  const answer = await askLiveOpenPr(ports, repo, headBranch, baseBranch);
  return answer.asked ? answer.pr : null;
}
