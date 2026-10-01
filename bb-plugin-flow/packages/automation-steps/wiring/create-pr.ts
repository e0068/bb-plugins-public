// Layer 3 (shell), the testable part — orchestrates the GitHub flow for
// creating a PR.
//
// The sequencing logic (base → merge-base commit → blobs → tree → commit →
// ref → pull) and response parsing live here and are verified with a fake
// `send`, no real network. The actual `send` (fetch, authorization) is in
// github-client.ts, the single effect point.
import {
  blobRequest,
  buildTreeEntries,
  commitRequest,
  createRefRequest,
  getBranchRequest,
  getCommitRequest,
  pullRequestRequest,
  treeRequest,
  updateRefRequest,
  type ChangedFile,
  type GithubRequest,
  type RepoRef,
} from "../core/github-requests";

export interface GithubResponse {
  status: number;
  data: unknown;
}

/** The single effect port: send the request and return status and body. Does not throw on an HTTP error code. */
export interface CreatePrPorts {
  send(req: GithubRequest): Promise<GithubResponse>;
}

export interface CreatePrInput {
  repo: RepoRef;
  /** The PR's base branch. */
  baseBranch: string;
  /**
   * The merge-base of the branch with `origin/<baseBranch>` — the commit
   * `files` were diffed against. It becomes the parent of the PR's commit
   * and the source of base_tree, so the commit carries exactly the branch's
   * own changes and GitHub merges them into the (possibly moved) base itself.
   */
  mergeBaseSha: string;
  /** The name of the head branch being created/updated on the remote. */
  headBranch: string;
  files: readonly ChangedFile[];
  title: string;
  body: string;
}

export interface CreatePrResult {
  url: string;
  number: number;
}

export async function runCreatePr(
  ports: CreatePrPorts,
  input: CreatePrInput,
): Promise<CreatePrResult> {
  const { repo, baseBranch, headBranch } = input;

  // Only 404 means the base is missing; a refusal (rate limit, access) is named with GitHub's own message.
  const base = await ports.send(getBranchRequest(repo, baseBranch));
  if (base.status === 404) throw new Error(`base "${baseBranch}" not found on GitHub (HTTP 404)`);
  requireStatus(base, 200, `reading base "${baseBranch}"`);

  const treeSha = await prTree(ports, input);
  const commitSha = await prCommit(ports, input, treeSha);
  await putHeadRef(ports, repo, headBranch, commitSha);

  const pr = await ports.send(
    pullRequestRequest(repo, {
      title: input.title,
      body: input.body,
      head: headBranch,
      base: baseBranch,
    }),
  );
  requireStatus(pr, 201, "opening pull request");
  return { url: pickString(pr.data, ["html_url"]), number: pickNumber(pr.data, ["number"]) };
}

/** What the PR's commit is made of — shared by opening the PR and refreshing its branch. */
export type PrCommitInput = Pick<CreatePrInput, "repo" | "mergeBaseSha" | "headBranch" | "files" | "title">;

/** What refreshing did to the open PR's branch on GitHub. */
export type RefreshOutcome = "updated" | "unchanged";

/**
 * Brings the branch of an already open PR up to the thread's branch. The PR's
 * commit is rebuilt exactly as runCreatePr builds it — parented on the
 * merge-base, the branch's files over its tree — and the head is moved onto
 * it. Whatever the head carried on top (a version bump, GitHub's "Update
 * branch") is dropped: the bump step behind this one in the chain lays it
 * again over the fresh head. A branch whose own PR commit already has that
 * tree is left alone, bump and all, so a retry creates no commit and no
 * force-move.
 */
export async function runRefreshPr(ports: CreatePrPorts, input: PrCommitInput): Promise<RefreshOutcome> {
  const { repo, headBranch } = input;
  const head = await ports.send(getBranchRequest(repo, headBranch));
  if (head.status === 404) throw new Error(`the open PR's branch "${headBranch}" is not on GitHub (HTTP 404)`);
  requireStatus(head, 200, `reading branch ${headBranch}`);
  const headCommit = { tree: pickString(head.data, ["commit", "commit", "tree", "sha"]), firstParent: firstParentOf(pluck(head.data, ["commit", "parents"])) };

  const treeSha = await prTree(ports, input);
  if (await carriesTree(ports, input, headCommit, treeSha, OWN_COMMIT_DEPTH)) return "unchanged";
  const commitSha = await prCommit(ports, input, treeSha);
  const moved = await ports.send(updateRefRequest(repo, headBranch, commitSha));
  requireStatus(moved, 200, `updating branch ${headBranch}`);
  return "updated";
}

/**
 * How deep under the head the PR's own commit is looked for: the bump step
 * lays a version commit over GitHub's "Update branch" merge, which sits over
 * the PR's commit — both keep it as their first parent.
 */
const OWN_COMMIT_DEPTH = 3;

interface CommitNode {
  tree: string;
  firstParent: string | null;
}

const firstParentOf = (parents: unknown): string | null => {
  const sha = Array.isArray(parents) ? pluck(parents[0], ["sha"]) : undefined;
  return typeof sha === "string" ? sha : null;
};

/**
 * Whether the head or one of its first parents above the merge-base already
 * has `treeSha` — that is, the branch already carries this content.
 */
async function carriesTree(ports: CreatePrPorts, input: PrCommitInput, node: CommitNode, treeSha: string, depth: number): Promise<boolean> {
  if (node.tree === treeSha) return true;
  const parent = node.firstParent;
  if (depth <= 1 || parent === null || parent === input.mergeBaseSha) return false;
  const res = await ports.send(getCommitRequest(input.repo, parent));
  requireStatus(res, 200, `reading commit ${parent.slice(0, 7)}`);
  return carriesTree(ports, input, { tree: pickString(res.data, ["tree", "sha"]), firstParent: firstParentOf(pluck(res.data, ["parents"])) }, treeSha, depth - 1);
}

/** The branch's files laid over the merge-base's tree. */
async function prTree(ports: CreatePrPorts, input: PrCommitInput): Promise<string> {
  const { repo, mergeBaseSha } = input;
  const mergeBase = await ports.send(getCommitRequest(repo, mergeBaseSha));
  requireStatus(mergeBase, 200, `reading merge-base ${mergeBaseSha.slice(0, 7)}`);
  const baseTreeSha = pickString(mergeBase.data, ["tree", "sha"]);

  const blobShaByPath = await createBlobs(ports, repo, input.files);
  const entries = buildTreeEntries(input.files, blobShaByPath);

  const tree = await ports.send(treeRequest(repo, baseTreeSha, entries));
  requireStatus(tree, 201, "creating tree");
  return pickString(tree.data, ["sha"]);
}

async function prCommit(ports: CreatePrPorts, input: PrCommitInput, treeSha: string): Promise<string> {
  const commit = await ports.send(
    commitRequest(input.repo, { message: input.title, treeSha, parentSha: input.mergeBaseSha }),
  );
  requireStatus(commit, 201, "creating commit");
  return pickString(commit.data, ["sha"]);
}

export async function createBlobs(
  ports: CreatePrPorts,
  repo: RepoRef,
  files: readonly ChangedFile[],
): Promise<Record<string, string>> {
  const shaByPath: Record<string, string> = {};
  for (const file of files) {
    if (file.kind !== "upsert") continue;
    const res = await ports.send(blobRequest(repo, file.content, file.encoding));
    requireStatus(res, 201, `creating blob ${file.path}`);
    shaByPath[file.path] = pickString(res.data, ["sha"]);
  }
  return shaByPath;
}

// The branch may not exist on the remote yet (404) — then we create the ref;
// otherwise we move the existing one to the new commit.
async function putHeadRef(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  commitSha: string,
): Promise<void> {
  const existing = await ports.send(getBranchRequest(repo, headBranch));
  if (existing.status === 200) {
    const res = await ports.send(updateRefRequest(repo, headBranch, commitSha));
    requireStatus(res, 200, `updating branch ${headBranch}`);
    return;
  }
  if (existing.status === 404) {
    const res = await ports.send(createRefRequest(repo, headBranch, commitSha));
    requireStatus(res, 201, `creating branch ${headBranch}`);
    return;
  }
  throw new Error(`could not check branch ${headBranch} (HTTP ${existing.status})`);
}

export function requireStatus(res: GithubResponse, expected: number, step: string): void {
  if (res.status !== expected) {
    throw new Error(`${step}: GitHub responded HTTP ${res.status} (${describe(res.data)})`);
  }
}

function describe(data: unknown): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "no message";
}

export function pickString(data: unknown, path: readonly string[]): string {
  const value = pluck(data, path);
  if (typeof value !== "string") {
    throw new Error(`expected a string in the GitHub response at path ${path.join(".")}`);
  }
  return value;
}

function pickNumber(data: unknown, path: readonly string[]): number {
  const value = pluck(data, path);
  if (typeof value !== "number") {
    throw new Error(`expected a number in the GitHub response at path ${path.join(".")}`);
  }
  return value;
}

function pluck(data: unknown, path: readonly string[]): unknown {
  let node: unknown = data;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}
