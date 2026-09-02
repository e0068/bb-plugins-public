// Layer 3 (shell), the testable part — orchestrates the GitHub flow for
// creating a PR.
//
// The sequencing logic (base → blobs → tree → commit → ref → pull) and
// response parsing live here and are verified with a fake `send`, no real
// network. The actual `send` (fetch, authorization) is in github-client.ts,
// the single effect point.
import {
  blobRequest,
  buildTreeEntries,
  commitRequest,
  createRefRequest,
  getBranchRequest,
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
  /** The PR's base branch (also the source of base_tree and the commit's parent). */
  baseBranch: string;
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

  const base = await ports.send(getBranchRequest(repo, baseBranch));
  if (base.status !== 200) {
    throw new Error(`base "${baseBranch}" not found on GitHub (HTTP ${base.status})`);
  }
  const baseCommitSha = pickString(base.data, ["commit", "sha"]);
  const baseTreeSha = pickString(base.data, ["commit", "commit", "tree", "sha"]);

  const blobShaByPath = await createBlobs(ports, repo, input.files);
  const entries = buildTreeEntries(input.files, blobShaByPath);

  const tree = await ports.send(treeRequest(repo, baseTreeSha, entries));
  requireStatus(tree, 201, "creating tree");
  const treeSha = pickString(tree.data, ["sha"]);

  const commit = await ports.send(
    commitRequest(repo, { message: input.title, treeSha, parentSha: baseCommitSha }),
  );
  requireStatus(commit, 201, "creating commit");
  const commitSha = pickString(commit.data, ["sha"]);

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

async function createBlobs(
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

function requireStatus(res: GithubResponse, expected: number, step: string): void {
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

function pickString(data: unknown, path: readonly string[]): string {
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
