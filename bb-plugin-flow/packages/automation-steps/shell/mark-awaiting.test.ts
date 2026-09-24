// @vitest-environment node
// Нажатие публикации или мёрджа должно оставить отметку «ждёт» — без неё
// значок так и не спросит GitHub о новом PR. Обещания на настоящем
// репозитории во временном каталоге ОС.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "../steps";
import { gitClient } from "../wiring/git-client";
import { readMark } from "../wiring/pr-await-store";
import type { PluginsPort } from "../wiring/plugin-reinstall";
import { markAwaiting, resolvePrSignal, type Sdk } from "./pr-helpers";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const BRANCH = "bb/flow-thr_x";
const repo = () => {
  const path = mkdtempSync(join(tmpdir(), "mark-awaiting-"));
  dirs.push(path);
  execFileSync("git", ["init", "-q", "-b", BRANCH, path]);
  return path;
};

const PR_SETTLED = { outcome: "available", pullRequest: { state: "merged", url: "https://x/1", number: 1, checks: { state: "passing" }, mergeability: { mergeable: "MERGEABLE" } } };

/** SDK треда с окружением на диске; `get` можно уронить. */
const sdk = (path: string | null, over: { getFails?: boolean } = {}) =>
  ({
    threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T" }) },
    environments: {
      get: async () => {
        if (over.getFails) throw new Error("bb is down");
        return { id: "e1", hostId: "h", path, branchName: BRANCH, baseBranch: "main", remoteUrl: null };
      },
      pullRequest: async () => PR_SETTLED,
      mergePullRequest: async () => ({}),
    },
  }) as unknown as Sdk;

const plugins: PluginsPort = {
  list: async () => ({ plugins: [] }),
  applyUpdate: async () => ({}) as never,
  install: async () => ({}) as never,
  remove: async () => ({}) as never,
};

describe("markAwaiting", () => {
  it("оставляет свежую отметку нужного вида на ветке окружения", async () => {
    const path = repo();
    await markAwaiting(sdk(path), "e1", "publish");
    expect(await readMark(gitClient(path), BRANCH)).toMatchObject({ kind: "publish", askedAt: null, found: null });
  });

  it("сбой bb не валит действие: отметки нет, исключения нет", async () => {
    await expect(markAwaiting(sdk(repo(), { getFails: true }), "e1", "merge")).resolves.toBeUndefined();
  });

  it("окружение без рабочей копии — ничего не пишется и не падает", async () => {
    await expect(markAwaiting(sdk(null), "e1", "merge")).resolves.toBeUndefined();
  });
});

describe("шаг git.merge", () => {
  it("после попытки мёрджа на ветке стоит отметка merge", async () => {
    const path = repo();
    const ports: StepPorts = { sdk: sdk(path), kv: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] } as never, settings: { get: async () => ({ githubToken: "token" }) }, plugins, ownPluginId: "flow" };
    await createSteps(ports)["git.merge"]("t1");
    expect(await readMark(gitClient(path), BRANCH)).toMatchObject({ kind: "merge" });
  });
});

describe("resolvePrSignal без отметки", () => {
  it("влитый PR, отметки нет → сигнал bb, токен и GitHub не нужны", async () => {
    let tokens = 0;
    const signal = await resolvePrSignal(sdk(repo()), async () => {
      tokens += 1;
      return "token";
    }, "e1", { hostId: "h", path: null, branchName: BRANCH }, null);
    expect(signal).toMatchObject({ presence: "settled", number: 1 });
    const onDisk = await resolvePrSignal(sdk(repo()), async () => {
      tokens += 1;
      return "token";
    }, "e1", { hostId: "h", path: repo(), branchName: BRANCH }, null);
    expect(onDisk).toMatchObject({ presence: "settled", number: 1 });
    expect(tokens).toBe(0);
  });
});
