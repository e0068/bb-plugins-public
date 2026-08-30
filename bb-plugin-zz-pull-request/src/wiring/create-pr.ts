// Слой 3 (оболочка), тестируемая часть — оркестрация GitHub-потока создания PR.
//
// Логика последовательности (base → blobs → tree → commit → ref → pull) и разбор
// ответов живут здесь и проверяются фейковым `send` без сети. Сам `send` (fetch,
// авторизация) — в github-client.ts, единственной точке эффекта.
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

/** Единственный порт эффекта: выполнить запрос и вернуть статус и тело. Не бросает на HTTP-коде. */
export interface CreatePrPorts {
  send(req: GithubRequest): Promise<GithubResponse>;
}

export interface CreatePrInput {
  repo: RepoRef;
  /** Базовая ветка PR (она же источник base_tree и родителя коммита). */
  baseBranch: string;
  /** Имя head-ветки, создаваемой/обновляемой на remote. */
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
    throw new Error(`база «${baseBranch}» не найдена на GitHub (HTTP ${base.status})`);
  }
  const baseCommitSha = pickString(base.data, ["commit", "sha"]);
  const baseTreeSha = pickString(base.data, ["commit", "commit", "tree", "sha"]);

  const blobShaByPath = await createBlobs(ports, repo, input.files);
  const entries = buildTreeEntries(input.files, blobShaByPath);

  const tree = await ports.send(treeRequest(repo, baseTreeSha, entries));
  requireStatus(tree, 201, "создание дерева");
  const treeSha = pickString(tree.data, ["sha"]);

  const commit = await ports.send(
    commitRequest(repo, { message: input.title, treeSha, parentSha: baseCommitSha }),
  );
  requireStatus(commit, 201, "создание коммита");
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
  requireStatus(pr, 201, "открытие pull request");
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
    requireStatus(res, 201, `создание блоба ${file.path}`);
    shaByPath[file.path] = pickString(res.data, ["sha"]);
  }
  return shaByPath;
}

// Ветки на remote может ещё не быть (404) — тогда создаём ref, иначе двигаем
// существующий на новый коммит.
async function putHeadRef(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  commitSha: string,
): Promise<void> {
  const existing = await ports.send(getBranchRequest(repo, headBranch));
  if (existing.status === 200) {
    const res = await ports.send(updateRefRequest(repo, headBranch, commitSha));
    requireStatus(res, 200, `обновление ветки ${headBranch}`);
    return;
  }
  if (existing.status === 404) {
    const res = await ports.send(createRefRequest(repo, headBranch, commitSha));
    requireStatus(res, 201, `создание ветки ${headBranch}`);
    return;
  }
  throw new Error(`не удалось проверить ветку ${headBranch} (HTTP ${existing.status})`);
}

function requireStatus(res: GithubResponse, expected: number, step: string): void {
  if (res.status !== expected) {
    throw new Error(`${step}: GitHub ответил HTTP ${res.status} (${describe(res.data)})`);
  }
}

function describe(data: unknown): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "без сообщения";
}

function pickString(data: unknown, path: readonly string[]): string {
  const value = pluck(data, path);
  if (typeof value !== "string") {
    throw new Error(`ожидал строку в ответе GitHub по пути ${path.join(".")}`);
  }
  return value;
}

function pickNumber(data: unknown, path: readonly string[]): number {
  const value = pluck(data, path);
  if (typeof value !== "number") {
    throw new Error(`ожидал число в ответе GitHub по пути ${path.join(".")}`);
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
