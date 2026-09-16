// Layer 1 — pure builders for GitHub REST (Git Data API) requests. Zero effects.
//
// The PR is opened without a push: the branch content is rebuilt right on
// GitHub — a blob for each changed file → a tree (base_tree = the tree of the
// merge-base with the base branch) → a commit (parent = the merge-base) → a
// ref for the new head branch → the pull request. The merge-base, not the
// tip of the base, is the parent on purpose: the changes were diffed against
// it, so applied on top of it they are exactly the branch's own work, and
// GitHub three-way merges them into the moved base itself — showing a
// conflict where the base changed the same file, instead of the PR silently
// overwriting it (see memory/decisions/pr-commit-parent-is-merge-base.md).
// Only the request bodies live here;
// their sequencing and the network are in the shell (Layer 3), because there
// is a dependency between steps through the returned shas.

import type { Mergeability } from "./merge-readiness";

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Path relative to https://api.github.com; the shell adds the base URL and authorization. */
export interface GithubRequest {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: unknown;
}

/** A change to a single branch file relative to the base branch. */
export type ChangedFile =
  | { kind: "upsert"; path: string; content: string; encoding: "utf-8" | "base64" }
  | { kind: "delete"; path: string };

/** A GitHub tree entry: a regular file (blob `sha`) or a deletion (`sha: null`). */
export interface TreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
}

function base(repo: RepoRef): string {
  return `/repos/${repo.owner}/${repo.repo}`;
}

/**
 * GET for a single branch: gives its tip (`commit.sha`) and its tree
 * (`commit.commit.tree.sha`) for base_tree and the commit's parent; a 404
 * means "the branch doesn't exist on the remote".
 */
export function getBranchRequest(repo: RepoRef, branch: string): GithubRequest {
  return { method: "GET", path: `${base(repo)}/branches/${branch}` };
}

/**
 * GET a single commit: gives its tree (`tree.sha`). Used for the merge-base
 * commit — the parent of the PR's commit and the base_tree its changes are
 * applied to. A 404 means the merge-base isn't on GitHub (the base was
 * force-pushed since it was fetched).
 */
export function getCommitRequest(repo: RepoRef, sha: string): GithubRequest {
  return { method: "GET", path: `${base(repo)}/git/commits/${sha}` };
}

/**
 * GET one pull request. The field read from it is `mergeable`: GitHub sets
 * it to null while it recomputes the PR after its head moved, and a merge
 * requested inside that window is refused as "not currently mergeable".
 */
export function getPullRequestRequest(repo: RepoRef, number: number): GithubRequest {
  return { method: "GET", path: `${base(repo)}/pulls/${number}` };
}

/** `mergeable` as a verdict: true and false are answers; null (still computing) and anything malformed are not. */
export function parsePullMergeability(data: unknown): Mergeability {
  if (!data || typeof data !== "object") return "unknown";
  const { mergeable } = data as { mergeable?: unknown };
  if (mergeable === true) return "mergeable";
  if (mergeable === false) return "conflicting";
  return "unknown";
}

export function blobRequest(
  repo: RepoRef,
  content: string,
  encoding: "utf-8" | "base64",
): GithubRequest {
  return { method: "POST", path: `${base(repo)}/git/blobs`, body: { content, encoding } };
}

/**
 * Builds tree entries from the changes and a `path → blob sha` map.
 * Deletions produce `sha: null`; for upserts, the sha comes from the map
 * (populated by the shell after creating the blobs). Entry order follows
 * the order of the changes.
 */
export function buildTreeEntries(
  files: readonly ChangedFile[],
  blobShaByPath: Readonly<Record<string, string>>,
): TreeEntry[] {
  return files.map((file) => {
    if (file.kind === "delete") {
      return { path: file.path, mode: "100644", type: "blob", sha: null };
    }
    const sha = blobShaByPath[file.path];
    if (sha === undefined) {
      throw new Error(`no blob sha for ${file.path}`);
    }
    return { path: file.path, mode: "100644", type: "blob", sha };
  });
}

export function treeRequest(
  repo: RepoRef,
  baseTreeSha: string,
  entries: readonly TreeEntry[],
): GithubRequest {
  return {
    method: "POST",
    path: `${base(repo)}/git/trees`,
    body: { base_tree: baseTreeSha, tree: entries },
  };
}

export function commitRequest(
  repo: RepoRef,
  input: { message: string; treeSha: string; parentSha: string },
): GithubRequest {
  return {
    method: "POST",
    path: `${base(repo)}/git/commits`,
    body: { message: input.message, tree: input.treeSha, parents: [input.parentSha] },
  };
}

export function createRefRequest(
  repo: RepoRef,
  branch: string,
  commitSha: string,
): GithubRequest {
  return {
    method: "POST",
    path: `${base(repo)}/git/refs`,
    body: { ref: `refs/heads/${branch}`, sha: commitSha },
  };
}

export function updateRefRequest(
  repo: RepoRef,
  branch: string,
  commitSha: string,
): GithubRequest {
  return {
    method: "PATCH",
    path: `${base(repo)}/git/refs/heads/${branch}`,
    body: { sha: commitSha, force: true },
  };
}

export function pullRequestRequest(
  repo: RepoRef,
  input: { title: string; body: string; head: string; base: string },
): GithubRequest {
  return {
    method: "POST",
    path: `${base(repo)}/pulls`,
    body: {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
    },
  };
}

/**
 * GET a file's content at a specific ref (a branch name or a commit sha) via
 * the Contents API — used to read a plugin's package.json both at the base
 * branch's current tip and at the PR's merge-base, independent of the local
 * working copy. A 404 means no such file at that ref (e.g. a shared layer
 * with no package.json of its own).
 */
export function contentsRequest(repo: RepoRef, path: string, ref: string): GithubRequest {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return { method: "GET", path: `${base(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}` };
}

/**
 * Parses {@link contentsRequest}'s response into the file's raw base64
 * content. `null` when the shape isn't a single base64-encoded file's
 * content: an array (the path names a directory), an absent "content"
 * field, or `encoding` other than "base64" — GitHub returns an empty
 * `content` with no usable encoding for files over 1 MB, which must not be
 * mistaken for an empty file.
 */
export function parseFileContent(data: unknown): string | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.encoding !== "base64") return null;
  return typeof record.content === "string" ? record.content : null;
}

/**
 * GET the single most recently created issue or PR in the repo. Issues and
 * PRs share one number sequence, so this is the highest number handed out
 * so far — the shell turns it into "the number a new PR will (almost
 * certainly) get" for display before the click.
 */
export function latestIssueRequest(repo: RepoRef): GithubRequest {
  return { method: "GET", path: `${base(repo)}/issues?state=all&per_page=1` };
}

/**
 * Parses {@link latestIssueRequest}'s response into "the next PR's number":
 * the latest issue/PR's number plus one, or `1` for a repo with none yet.
 * `null` when the shape isn't the expected array — an error body, a future
 * API change — so the caller can degrade to showing no number.
 */
export function parseNextPrNumber(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  if (data.length === 0) return 1;
  const latest = data[0];
  const number =
    latest && typeof latest === "object" ? (latest as { number?: unknown }).number : undefined;
  return typeof number === "number" ? number + 1 : null;
}

/**
 * GET the open pull request(s) for one head→base pair. Used to measure the
 * live truth directly when the host's own PR signal is stuck on a stale
 * verdict (see memory/decisions/open-pr-bypass-host-terminal-signal.md) —
 * unlike {@link latestIssueRequest}, this asks GitHub itself, not "what did
 * bb last see".
 */
export function listOpenPullRequestsRequest(
  repo: RepoRef,
  headBranch: string,
  baseBranch: string,
): GithubRequest {
  const head = encodeURIComponent(`${repo.owner}:${headBranch}`);
  return {
    method: "GET",
    path: `${base(repo)}/pulls?head=${head}&base=${encodeURIComponent(baseBranch)}&state=open`,
  };
}

/** The one field an open PR is displayed by: its number and where to open it. */
export interface OpenPullRequest {
  number: number;
  url: string;
}

/**
 * Parses {@link listOpenPullRequestsRequest}'s response into the live PR for
 * that head→base pair, or `null` — an empty array (genuinely none open), a
 * non-array body (an error response, a future API change), or an entry
 * missing the fields we need. All three degrade the same way: the caller
 * cannot confirm a live PR exists, so it falls back to whatever signal it
 * had before asking.
 */
export function parseOpenPullRequest(data: unknown): OpenPullRequest | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  const { number, html_url: url } = first as { number?: unknown; html_url?: unknown };
  return typeof number === "number" && typeof url === "string" ? { number, url } : null;
}

/**
 * GET the comparison of the base with a head branch: how far behind the head
 * is (`behind_by`) and which files it changes. Both facts are needed at
 * merge time — whether the branch has to be caught up with the base before
 * its version can be bumped without a conflict, and which plugins the merge
 * will touch at all.
 */
export function compareRequest(repo: RepoRef, baseBranch: string, headBranch: string): GithubRequest {
  return {
    method: "GET",
    path: `${base(repo)}/compare/${encodeRef(baseBranch)}...${encodeRef(headBranch)}`,
  };
}

export interface Comparison {
  /** Commits the base has that the head does not. Zero means the branch already contains the base. */
  behindBy: number;
  changedPaths: string[];
}

/**
 * Parses {@link compareRequest}'s response. `null` when the body isn't a
 * comparison (an error message, a shape change) — the caller treats that as
 * "cannot tell" rather than as "zero behind, nothing changed", which would
 * silently license the wrong action.
 */
export function parseComparison(data: unknown): Comparison | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.behind_by !== "number") return null;
  const files = Array.isArray(record.files) ? record.files : [];
  return {
    behindBy: record.behind_by,
    changedPaths: files
      .map((file) =>
        file !== null && typeof file === "object"
          ? (file as { filename?: unknown }).filename
          : undefined,
      )
      .filter((name): name is string => typeof name === "string"),
  };
}

/**
 * PUT to merge the base branch into the PR's head branch — GitHub's own
 * "Update branch". `expected_head_sha` pins it to the head we measured, so a
 * branch that moved under us fails the call instead of quietly updating
 * something else. A conflict fails it too (422), which is the point: an
 * automatic version bump must not be built on top of an unresolved merge.
 */
export function updateBranchRequest(
  repo: RepoRef,
  pullNumber: number,
  expectedHeadSha: string,
): GithubRequest {
  return {
    method: "PUT",
    path: `${base(repo)}/pulls/${pullNumber}/update-branch`,
    body: { expected_head_sha: expectedHeadSha },
  };
}

// A ref keeps its slashes — GitHub reads `main...bb/thr_x` as two refs, and
// a percent-encoded slash there is a 404. Only the segments are escaped,
// exactly as contentsRequest does for paths.
function encodeRef(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}
