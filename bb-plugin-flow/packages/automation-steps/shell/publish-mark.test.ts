// @vitest-environment node
// Нажатие «Открыть PR» оставляет на ветке отметку «ждёт публикации»: только
// по ней значок строки спросит GitHub о новом PR на ветке, у которой bb
// помнит прошлый, уже влитый. Обещание проверяется по результату — отметке
// на диске после действия — на настоящем репозитории и подменённом fetch.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
const repo = () => {
  const path = mkdtempSync(join(tmpdir(), "publish-mark-"));
  dirs.push(path);
  execFileSync("git", ["init", "-q", "-b", BRANCH, path]);
  return path;
};

const SETTLED = { outcome: "available", pullRequest: { state: "merged", url: "https://github.com/e0068/bb-plugins/pull/1", number: 1, checks: { state: "passing" }, mergeability: { mergeable: "MERGEABLE" } } };

/** Тред с влитым прошлым PR, чистым деревом и одним коммитом впереди базы. */
const sdk = (path: string) =>
  ({
    threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T", titleFallback: "T" }) },
    environments: {
      get: async () => ({ id: "e1", hostId: "h", path, branchName: BRANCH, mergeBaseBranch: null, defaultBranch: "main", baseBranch: "origin/main" }),
      status: async () => ({
        outcome: "available",
        workspace: {
          workingTree: { hasUncommittedChanges: false },
          mergeBase: { aheadCount: 1, behindCount: 0, baseRef: "d181e887f29b63f7cb054af63f09817518076ea0", files: [], commits: [{ subject: "work" }] },
          checkout: { kind: "branch", branchName: BRANCH, headSha: "sha-current" },
        },
      }),
      pullRequest: async () => SETTLED,
    },
    files: {
      read: async ({ path: file }: { path: string }) => {
        if (file.endsWith("/.git/config")) return { content: '[remote "origin"]\n\turl = https://github.com/e0068/bb-plugins.git\n', contentEncoding: "utf8" };
        throw new Error("not a file");
      },
    },
  }) as unknown as Sdk;

const kv = { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] } as never;

/** GitHub: список открытых PR ветки — `open`; остальное отвечает 500. */
const github = (open: unknown[]) =>
  vi.stubGlobal("fetch", async (url: string) =>
    String(url).includes("/pulls?") ? new Response(JSON.stringify(open), { status: 200 }) : new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
  );

describe("gatherAndCreate оставляет отметку публикации", () => {
  it("создание PR упало на полпути → отметка publish на ветке: GitHub мог успеть создать PR", async () => {
    const path = repo();
    github([]);
    await expect(gatherAndCreate(sdk(path), kv, "token", "t1")).rejects.toThrow();
    expect(await readMark(gitClient(path), BRANCH)).toMatchObject({ kind: "publish", found: null });
  });

  it("повтор нашёл открытый PR, а bb помнит прошлый влитый → отметка publish на ветке", async () => {
    const path = repo();
    github([{ number: 41, html_url: "https://github.com/e0068/bb-plugins/pull/41" }]);
    expect(await gatherAndCreate(sdk(path), kv, "token", "t1")).toMatchObject({ number: 41, existed: true });
    expect(await readMark(gitClient(path), BRANCH)).toMatchObject({ kind: "publish" });
  });
});
