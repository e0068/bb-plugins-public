// @vitest-environment node
// Повтор «Открыть PR» при уже открытом PR довозит в него то, что закоммичено в
// ветку после открытия: раньше шаг отвечал «already open» и выходил, и ветка на
// GitHub оставалась на старом содержимом (так 19 коммитов Shapeshift не дошли
// до PR #33). Обещание проверяется по запросам к GitHub на настоящем
// репозитории с подменённым fetch.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gitClient } from "../wiring/git-client";
import { readMark } from "../wiring/pr-await-store";
import { gatherAndCreate, type Sdk } from "./pr-helpers";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.unstubAllGlobals();
});

const BRANCH = "bb/flow-thr_x";
const FILE = "a.ts";
const PR_URL = "https://github.com/e0068/bb-plugins/pull/41";

const git = (path: string, ...args: string[]) =>
  execFileSync("git", ["-C", path, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();

/** Репозиторий: база и коммит ветки поверх неё, правящий один файл. */
const repoAhead = () => {
  const path = mkdtempSync(join(tmpdir(), "open-pr-refresh-"));
  dirs.push(path);
  execFileSync("git", ["init", "-q", "-b", BRANCH, path]);
  writeFileSync(join(path, FILE), "old\n");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "base");
  const mergeBase = git(path, "rev-parse", "HEAD");
  writeFileSync(join(path, FILE), "new\n");
  git(path, "commit", "-q", "-am", "work");
  return { path, mergeBase };
};

/** bb помнит прошлый, уже влитый PR ветки; ветка на одном коммите впереди базы, дерево чистое, если не сказано иное. */
const sdk = (path: string, mergeBase: string, dirty = false) =>
  ({
    threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T", titleFallback: "T" }) },
    environments: {
      get: async () => ({ id: "e1", hostId: "h", path, branchName: BRANCH, mergeBaseBranch: null, defaultBranch: "main", baseBranch: "origin/main" }),
      status: async () => ({
        outcome: "available",
        workspace: {
          workingTree: { hasUncommittedChanges: dirty },
          mergeBase: { aheadCount: 1, behindCount: 0, baseRef: mergeBase, files: [{ path: FILE, status: "M" }], commits: [{ subject: "work" }] },
          checkout: { kind: "branch", branchName: BRANCH, headSha: "sha-current" },
        },
      }),
      pullRequest: async () => ({ outcome: "available", pullRequest: { state: "merged", url: "https://github.com/e0068/bb-plugins/pull/1", number: 1, checks: { state: "passing" }, mergeability: { mergeable: "MERGEABLE" } } }),
    },
    files: {
      read: async ({ path: file }: { path: string }) => {
        if (file.endsWith("/.git/config")) return { content: '[remote "origin"]\n\turl = https://github.com/e0068/bb-plugins.git\n', contentEncoding: "utf8" };
        if (file === `${path}/${FILE}`) return { content: "new\n", contentEncoding: "utf8" };
        throw new Error(`unexpected read ${file}`);
      },
    },
  }) as unknown as Sdk;

const kv = { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] } as never;

type Call = { method: string; url: string; body: unknown };

/** GitHub с открытым PR #41, чья ветка стоит на дереве `headTree`; дерево из файлов ветки — `tree-new`. */
const githubWithOpenPr = (headTree: string) => {
  const calls: Call[] = [];
  const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status });
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: path, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
    if (path.includes("/pulls?")) return json([{ number: 41, html_url: PR_URL }], 200);
    if (path.endsWith(`/branches/${BRANCH}`)) return json({ commit: { sha: "head", commit: { tree: { sha: headTree } } } }, 200);
    if (path.includes("/git/commits/")) return json({ sha: "mb", tree: { sha: "tree-mb" } }, 200);
    if (path.endsWith("/git/blobs")) return json({ sha: "blob-new" }, 201);
    if (path.endsWith("/git/trees")) return json({ sha: "tree-new" }, 201);
    if (path.endsWith("/git/commits")) return json({ sha: "commit-new" }, 201);
    if (method === "PATCH" && path.endsWith(`/git/refs/heads/${BRANCH}`)) return json({}, 200);
    return json({ message: `unexpected ${method} ${path}` }, 500);
  });
  return calls;
};

describe("gatherAndCreate при уже открытом PR", () => {
  it("ветка ушла вперёд → ветка PR на GitHub переставлена на коммит с её содержимым, второй PR не открыт", async () => {
    const { path, mergeBase } = repoAhead();
    const calls = githubWithOpenPr("tree-old");

    expect(await gatherAndCreate(sdk(path, mergeBase), kv, "token", "t1")).toEqual({ url: PR_URL, number: 41, branch: "updated" });

    const moved = calls.find((c) => c.method === "PATCH");
    expect(moved?.body).toEqual({ sha: "commit-new", force: true });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/pulls"))).toBe(false);
  });

  it("на GitHub уже то же содержимое → ветка не тронута", async () => {
    const { path, mergeBase } = repoAhead();
    const calls = githubWithOpenPr("tree-new");

    expect(await gatherAndCreate(sdk(path, mergeBase), kv, "token", "t1")).toEqual({ url: PR_URL, number: 41, branch: "unchanged" });

    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("в рабочей копии незакоммиченные правки → отказ, ветка PR не тронута: на GitHub не уходит код, которого нет в коммитах", async () => {
    const { path, mergeBase } = repoAhead();
    const calls = githubWithOpenPr("tree-old");

    await expect(gatherAndCreate(sdk(path, mergeBase, true), kv, "token", "t1")).rejects.toThrow(/dirty/);

    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("найден открытый PR, а bb помнит прошлый влитый → отметка publish на ветке", async () => {
    const { path, mergeBase } = repoAhead();
    githubWithOpenPr("tree-new");

    await gatherAndCreate(sdk(path, mergeBase), kv, "token", "t1");

    expect(await readMark(gitClient(path), BRANCH)).toMatchObject({ kind: "publish" });
  });
});
