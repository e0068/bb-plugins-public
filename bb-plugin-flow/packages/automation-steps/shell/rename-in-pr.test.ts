// @vitest-environment node
// Перенос файла в ветке доезжает до PR переносом, а не копией: в дереве
// коммита PR новый путь появляется, а старый исчезает. bb перечисляет перенос
// одной строкой со статусом R и новым путём — без старого, поэтому раньше
// старый путь оставался в main рядом с новым (так в main разошлись по двум
// папкам статуса 94 файла задач). Обещание проверяется по дереву, которое шаг
// отправляет GitHub, на настоящем репозитории с переносом и подменённом fetch.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gatherAndCreate, type Sdk } from "./pr-helpers";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.unstubAllGlobals();
});

const BRANCH = "bb/flow-thr_x";
const OLD = "docs/tasks/in_review/Vakhnin Sergei/задача.md";
const NEW = "docs/tasks/done/Vakhnin Sergei/задача.md";
const KEPT = "docs/tasks/todo/other.md";

const git = (path: string, ...args: string[]) =>
  execFileSync("git", ["-C", path, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();

const write = (path: string, file: string, content: string) => {
  mkdirSync(dirname(join(path, file)), { recursive: true });
  writeFileSync(join(path, file), content);
};

/** Репозиторий: база с двумя файлами, ветка переносит один из них. */
const repoWithRename = () => {
  const path = mkdtempSync(join(tmpdir(), "rename-in-pr-"));
  dirs.push(path);
  execFileSync("git", ["init", "-q", "-b", BRANCH, path]);
  write(path, OLD, "---\ntitle: T\n---\n\nbody\n");
  write(path, KEPT, "kept\n");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "base");
  const mergeBase = git(path, "rev-parse", "HEAD");
  mkdirSync(dirname(join(path, NEW)), { recursive: true });
  git(path, "mv", OLD, NEW);
  git(path, "commit", "-q", "-m", "move");
  return { path, mergeBase };
};

/** bb видит перенос так, как отдаёт его статус: одной строкой R с новым путём. */
const sdk = (path: string, mergeBase: string) =>
  ({
    threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T", titleFallback: "T" }) },
    environments: {
      get: async () => ({ id: "e1", hostId: "h", path, branchName: BRANCH, mergeBaseBranch: null, defaultBranch: "main", baseBranch: "origin/main" }),
      status: async () => ({
        outcome: "available",
        workspace: {
          workingTree: { hasUncommittedChanges: false },
          mergeBase: { aheadCount: 1, behindCount: 0, baseRef: mergeBase, files: [{ path: NEW, status: "R" }], commits: [{ subject: "move" }] },
          checkout: { kind: "branch", branchName: BRANCH, headSha: "sha-current" },
        },
      }),
      pullRequest: async () => ({ outcome: "absent" }),
    },
    files: {
      read: async ({ path: file }: { path: string }) => {
        if (file.endsWith("/.git/config")) return { content: '[remote "origin"]\n\turl = https://github.com/e0068/bb-plugins.git\n', contentEncoding: "utf8" };
        if (file === `${path}/${NEW}`) return { content: "---\ntitle: T\n---\n\nbody\n", contentEncoding: "utf8" };
        throw new Error(`unexpected read ${file}`);
      },
    },
  }) as unknown as Sdk;

const kv = { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] } as never;

type TreeEntry = { path: string; sha: string | null };

/** GitHub отвечает до создания дерева; тело запроса дерева сохраняется, дальше — 500. */
const githubCapturingTree = () => {
  const trees: TreeEntry[][] = [];
  const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status });
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    const path = String(url);
    if (path.includes("/pulls?")) return json([], 200);
    if (path.includes("/branches/")) return json({ commit: { sha: "base" } }, 200);
    if (path.includes("/git/commits/")) return json({ sha: "mb", tree: { sha: "tree-mb" } }, 200);
    if (path.endsWith("/git/blobs")) return json({ sha: "blob-new" }, 201);
    if (path.endsWith("/git/trees")) trees.push(JSON.parse(init?.body ?? "{}").tree);
    return json({ message: "stop" }, 500);
  });
  return trees;
};

describe("gatherAndCreate: перенос файла в ветке", () => {
  it("дерево PR удаляет старый путь и пишет новый, нетронутый файл не трогает", async () => {
    const { path, mergeBase } = repoWithRename();
    const trees = githubCapturingTree();

    await expect(gatherAndCreate(sdk(path, mergeBase), kv, "token", "t1")).rejects.toThrow();

    expect(trees).toHaveLength(1);
    const byPath = new Map(trees[0]!.map((entry) => [entry.path, entry.sha]));
    expect(byPath.get(OLD)).toBeNull();
    expect(byPath.get(NEW)).toBe("blob-new");
    expect(byPath.has(KEPT)).toBe(false);
  });
});
