// @vitest-environment node
// Дочерний тред, чья база — ветка треда-родителя: у ветки родителя нет копии
// на origin, поэтому FF не ходит в origin, а «Открыть PR» и «Смёрджить PR»
// вливают ветку треда в дерево родителя. Стык с настоящим git.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "./steps";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `${file}: ${text}`);
};
const isAncestor = (cwd: string, a: string, b: string) => {
  try {
    git(cwd, "merge-base", "--is-ancestor", a, b);
    return true;
  } catch {
    return false;
  }
};

const PARENT_BRANCH = "bb/umbrella-thr_p";
const CHILD_BRANCH = "bb/wave-0-thr_c";

/** origin только с main; дерево родителя на своей ветке и дерево волны от неё. */
const trees = () => {
  const root = mkdtempSync(join(tmpdir(), "parent-delivery-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const parent = join(root, "parent");
  git(root, "clone", "-q", origin, parent);
  git(parent, "config", "core.hooksPath", "/dev/null");
  git(parent, "config", "user.email", "t@t");
  git(parent, "config", "user.name", "t");
  commit(parent, "shared.md", "base\n");
  git(parent, "push", "-q", "origin", "main");
  git(parent, "checkout", "-q", "-b", PARENT_BRANCH);
  commit(parent, "plan.md", "plan\n");
  const child = join(root, "child");
  git(parent, "worktree", "add", "-q", "-b", CHILD_BRANCH, child, PARENT_BRANCH);
  return { parent, child };
};

/** SDK: волна — дочерний тред зонтичного, окружения — два дерева выше. */
const sdkOf = ({ parent, child }: { parent: string; child: string }) =>
  ({
    threads: {
      get: async ({ threadId }: { threadId: string }) =>
        threadId === "child"
          ? { id: "child", environmentId: "e-child", parentThreadId: "parent" }
          : { id: "parent", environmentId: "e-parent", parentThreadId: null },
    },
    environments: {
      get: async ({ environmentId }: { environmentId: string }) =>
        environmentId === "e-child"
          ? { id: "e-child", path: child, branchName: CHILD_BRANCH, mergeBaseBranch: PARENT_BRANCH, defaultBranch: "main", baseBranch: "main" }
          : { id: "e-parent", path: parent, branchName: PARENT_BRANCH, mergeBaseBranch: null, defaultBranch: "main", baseBranch: "main" },
      mergePullRequest: async () => {
        throw new Error("PR на GitHub у дочернего треда не мёрджится");
      },
    },
  }) as unknown as StepPorts["sdk"];

const untouched = async () => {
  throw new Error("у дочернего треда плагины не трогаются");
};

const stepsFor = (paths: { parent: string; child: string }) =>
  createSteps({
    sdk: sdkOf(paths),
    kv: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
    settings: { get: async () => ({ githubToken: "token" }) },
    plugins: { list: untouched, applyUpdate: untouched, install: untouched, remove: untouched },
    ownPluginId: "flow",
    sleep: async () => {},
  });

describe("дочерний тред с базой — веткой родителя", () => {
  it("FF сверяется с веткой родителя на месте, без похода в origin", async () => {
    const paths = trees();
    commit(paths.parent, "later.md", "later\n");
    expect(await stepsFor(paths)["git.fast-forward"]("child")).toEqual({ ok: true, detail: "fast-forwarded" });
    expect(git(paths.child, "rev-parse", "HEAD")).toBe(git(paths.parent, "rev-parse", "HEAD"));
  });

  it("«Открыть PR» вливает ветку треда в дерево родителя и называет его ветку", async () => {
    const paths = trees();
    commit(paths.child, "wave.md", "wave\n");
    expect(await stepsFor(paths)["git.create-pr"]("child")).toEqual({
      ok: true,
      detail: `merged into ${PARENT_BRANCH} — the parent thread's branch, no PR on GitHub`,
    });
    expect(isAncestor(paths.parent, CHILD_BRANCH, PARENT_BRANCH)).toBe(true);
    expect(existsSync(join(paths.parent, "wave.md"))).toBe(true);
  });

  it("«Смёрджить PR» после влития отвечает, что ветка уже в родителе, и сам вливает дописанное", async () => {
    const paths = trees();
    const steps = stepsFor(paths);
    commit(paths.child, "wave.md", "wave\n");
    await steps["git.create-pr"]("child");
    expect(await steps["git.merge"]("child")).toEqual({ ok: true, detail: `already in ${PARENT_BRANCH}` });
    commit(paths.child, "fix.md", "fix\n");
    expect(await steps["git.merge"]("child")).toEqual({
      ok: true,
      detail: `merged into ${PARENT_BRANCH} — the parent thread's branch, no PR on GitHub`,
    });
    expect(existsSync(join(paths.parent, "fix.md"))).toBe(true);
  });

  it("бамп, Pull Main и обновление плагинов у дочернего треда не нужны и не падают", async () => {
    const steps = stepsFor(trees());
    const notNeeded = { ok: true, detail: `not needed — the branch goes into ${PARENT_BRANCH}, the parent thread's branch` };
    expect(await steps["files.bump-patch"]("child")).toEqual(notNeeded);
    expect(await steps["git.pull-main"]("child")).toEqual(notNeeded);
    expect(await steps["bb.reinstall"]("child")).toEqual(notNeeded);
  });

  it("дерево родителя стоит на другой ветке — отказ с обеими ветками, ничего не влито", async () => {
    const paths = trees();
    commit(paths.child, "wave.md", "wave\n");
    git(paths.parent, "checkout", "-q", "-b", "elsewhere");
    const outcome = await stepsFor(paths)["git.create-pr"]("child");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("elsewhere") });
    expect(outcome).toMatchObject({ error: expect.stringContaining(PARENT_BRANCH) });
    expect(isAncestor(paths.parent, CHILD_BRANCH, PARENT_BRANCH)).toBe(false);
    expect(isAncestor(paths.parent, CHILD_BRANCH, "elsewhere")).toBe(false);
  });

  it("конфликт с веткой родителя — провал с названным файлом, ветка родителя не тронута", async () => {
    const paths = trees();
    commit(paths.parent, "shared.md", "parent\n");
    commit(paths.child, "shared.md", "child\n");
    const before = git(paths.parent, "rev-parse", "HEAD");
    const outcome = await stepsFor(paths)["git.create-pr"]("child");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("shared.md") });
    expect(git(paths.parent, "rev-parse", "HEAD")).toBe(before);
    expect(git(paths.parent, "status", "--porcelain")).toBe("");
  });
});
