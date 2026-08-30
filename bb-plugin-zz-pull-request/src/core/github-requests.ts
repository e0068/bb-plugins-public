// Слой 1 — чистые построители запросов к GitHub REST (Git Data API). Ноль эффектов.
//
// PR открывается без push: содержимое ветки пересобирается прямо на GitHub —
// blob на каждый изменённый файл → tree (base_tree = дерево базовой ветки) →
// commit (parent = вершина базы) → ref новой head-ветки → pull request. Здесь
// только тела запросов; их последовательность и сеть — в оболочке (Слой 3),
// потому что между шагами есть зависимость по возвращённым sha.

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Путь относительно https://api.github.com; базовый URL и авторизацию добавляет оболочка. */
export interface GithubRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

/** Изменение одного файла ветки относительно базовой ветки. */
export type ChangedFile =
  | { kind: "upsert"; path: string; content: string; encoding: "utf-8" | "base64" }
  | { kind: "delete"; path: string };

/** Запись дерева GitHub: обычный файл (`sha` блоба) или удаление (`sha: null`). */
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
 * GET одной ветки: даёт вершину (`commit.sha`) и её дерево
 * (`commit.commit.tree.sha`) для base_tree и родителя коммита; 404 означает
 * «ветки на remote нет».
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
 * Собирает записи дерева из изменений и карты `путь → sha блоба`. Удаления
 * дают `sha: null`; для upsert sha берётся из карты (её наполняет оболочка,
 * создав блобы). Порядок записей повторяет порядок изменений.
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
      throw new Error(`нет sha блоба для ${file.path}`);
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
