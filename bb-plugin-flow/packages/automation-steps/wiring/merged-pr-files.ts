// Layer 2 — the files of a merged pull request, read from the PR itself.
//
// After a merge the head branch may already be gone: a repository with
// "Automatically delete head branches" drops it the moment the PR lands, and
// a comparison of the base with that branch then answers 404. The PR keeps
// both its head name and its file list, so the merged PR is found by the
// branch name and its files are read page by page
// (docs/decisions/reinstall-from-merged-pr-files.md).

import {
  PULL_FILES_PAGE_SIZE,
  listMergedPullRequestsRequest,
  parseMergedPullNumber,
  parsePullFiles,
  pullFilesRequest,
  type RepoRef,
} from "../core/github-requests";
import type { CreatePrPorts } from "./create-pr";

/** GitHub lists at most 3000 files of a pull request — thirty full pages. */
const MAX_PULL_FILES_PAGES = 30;

export type MergedPrFiles =
  | { ok: true; paths: string[] }
  | { ok: false; reason: string };

export async function mergedPullRequestFiles(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  baseBranch: string,
): Promise<MergedPrFiles> {
  const listed = await ports.send(listMergedPullRequestsRequest(repo, headBranch, baseBranch));
  if (listed.status !== 200) {
    return { ok: false, reason: `could not find the merged pull request (HTTP ${listed.status})` };
  }
  const number = parseMergedPullNumber(listed.data);
  if (number === null) {
    return { ok: false, reason: `GitHub shows no merged pull request from ${headBranch} into ${baseBranch}` };
  }
  return pullFilesFrom(ports, repo, number, 1, []);
}

async function pullFilesFrom(
  ports: CreatePrPorts,
  repo: RepoRef,
  number: number,
  page: number,
  read: readonly string[],
): Promise<MergedPrFiles> {
  const answer = await ports.send(pullFilesRequest(repo, number, page));
  const paths = answer.status === 200 ? parsePullFiles(answer.data) : null;
  if (paths === null) {
    return { ok: false, reason: `could not read the files of pull request #${number} (HTTP ${answer.status})` };
  }
  const all = [...read, ...paths];
  const lastPage = paths.length < PULL_FILES_PAGE_SIZE || page >= MAX_PULL_FILES_PAGES;
  return lastPage ? { ok: true, paths: all } : pullFilesFrom(ports, repo, number, page + 1, all);
}
