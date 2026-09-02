// Layer 1 — pure builders for GitHub REST (Git Data API) requests. Zero effects.
//
// The PR is opened without a push: the branch content is rebuilt right on
// GitHub — a blob for each changed file → a tree (base_tree = the base
// branch's tree) → a commit (parent = the tip of the base) → a ref for the
// new head branch → the pull request. Only the request bodies live here;
// their sequencing and the network are in the shell (Layer 3), because there
// is a dependency between steps through the returned shas.

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Path relative to https://api.github.com; the shell adds the base URL and authorization. */
export interface GithubRequest {
  method: "GET" | "POST" | "PATCH";
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
