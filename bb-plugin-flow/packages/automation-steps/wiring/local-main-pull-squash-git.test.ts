// @vitest-environment node
// Стык с настоящим git: локальный main после squash-слияния своего PR.
// Локальный main несёт исходные коммиты PR, origin — один squash-коммит с тем
// же содержимым, так что перемотка невозможна, хотя терять нечего.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitClient } from "./git-client";
import { runLocalMainPull } from "./local-main-pull";

// Утёкшие переменные git окружения треда направили бы команды в чужой репозиторий.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (cwd: string, files: Record<string, string>) => {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(cwd, file), text);
};
const commit = (cwd: string, files: Record<string, string>, message: string) => {
  write(cwd, files);
  git(cwd, "add", ...Object.keys(files));
  git(cwd, "commit", "-q", "-m", message);
};

/** origin с main и клон `other`, через который на origin приходят squash-слияния и чужие PR. */
const repos = () => {
  const root = mkdtempSync(join(tmpdir(), "main-pull-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  // Глобальные хуки владельца запрещают коммит в локальной копии; временный
  // репозиторий теста от них отвязывается, иначе прогон падает на хуке.
  git(origin, "config", "core.hooksPath", "/dev/null");
  const clone = (name: string) => {
    const path = join(root, name);
    git(root, "clone", "-q", origin, path);
    git(path, "config", "core.hooksPath", "/dev/null");
    git(path, "config", "user.email", "t@t");
    git(path, "config", "user.name", "t");
    return path;
  };
  const seed = clone("seed");
  commit(seed, { "shared.md": "base\n" }, "base");
  git(seed, "push", "-q", "origin", "main");
  return { root, clone, other: clone("other") };
};

/** Свой PR: в локальном main два коммита, на origin — один squash с тем же содержимым, а за ним чужой PR. */
const squashMergedPr = (local: string, other: string) => {
  commit(local, { "a.md": "a\n" }, "PR: a");
  commit(local, { "b.md": "b\n" }, "PR: b");
  commit(other, { "a.md": "a\n", "b.md": "b\n" }, "PR (#1) squash");
  commit(other, { "c.md": "c\n" }, "someone else's PR (#2)");
  git(other, "push", "-q", "origin", "main");
};

describe("Pull Main после squash-слияния своего PR", () => {
  it("main стоит в основной копии — шаг переставляет его на origin, незакоммиченное остаётся", async () => {
    const { root, clone, other } = repos();
    const integration = clone("integration");
    const env = join(root, "env");
    git(integration, "worktree", "add", "-q", "-b", "feature", env);
    squashMergedPr(integration, other);
    write(integration, { "notes.txt": "untracked\n" });

    await expect(runLocalMainPull(gitClient(env), "main")).resolves.toEqual({ ok: true });

    expect(git(integration, "rev-parse", "main")).toBe(git(other, "rev-parse", "HEAD"));
    expect(existsSync(join(integration, "c.md"))).toBe(true);
    expect(existsSync(join(integration, "notes.txt"))).toBe(true);
  });

  it("main не стоит ни в одной копии — шаг переставляет саму ссылку на origin", async () => {
    const { clone, other } = repos();
    const env = clone("env");
    squashMergedPr(env, other);
    git(env, "checkout", "-q", "-b", "feature");

    await expect(runLocalMainPull(gitClient(env), "main")).resolves.toEqual({ ok: true });

    expect(git(env, "rev-parse", "main")).toBe(git(other, "rev-parse", "HEAD"));
  });

  it("в локальном main есть работа, которой нет в origin, — прежний отказ, коммиты на месте", async () => {
    const { root, clone, other } = repos();
    const integration = clone("integration");
    const env = join(root, "env");
    git(integration, "worktree", "add", "-q", "-b", "feature", env);
    squashMergedPr(integration, other);
    commit(integration, { "local.md": "only here\n" }, "local work");
    const before = git(integration, "rev-parse", "main");

    const result = await runLocalMainPull(gitClient(env), "main");

    expect(result).toEqual({
      ok: false,
      reason: "local main has diverged from origin and can't be fast-forwarded (the usual state after a squash merge)",
    });
    expect(git(integration, "rev-parse", "main")).toBe(before);
  });

  it("ссылка main с чужой работой и нигде не стоит — прежний отказ, коммиты на месте", async () => {
    const { clone, other } = repos();
    const env = clone("env");
    squashMergedPr(env, other);
    commit(env, { "local.md": "only here\n" }, "local work");
    const before = git(env, "rev-parse", "main");
    git(env, "checkout", "-q", "-b", "feature");

    const result = await runLocalMainPull(gitClient(env), "main");

    expect(result.ok).toBe(false);
    expect(git(env, "rev-parse", "main")).toBe(before);
  });
});

describe("Pull Main после squash-слияния бережёт незакоммиченное в основной копии", () => {
  it("правка файла, который меняет origin, не затирается — отказ, main и правка на месте", async () => {
    const { root, clone, other } = repos();
    const integration = clone("integration");
    const env = join(root, "env");
    git(integration, "worktree", "add", "-q", "-b", "feature", env);
    squashMergedPr(integration, other);
    write(integration, { "c.md": "mine, uncommitted\n" });
    const before = git(integration, "rev-parse", "main");

    const result = await runLocalMainPull(gitClient(env), "main");

    expect(result.ok).toBe(false);
    expect(git(integration, "rev-parse", "main")).toBe(before);
    expect(git(integration, "status", "--porcelain")).toContain("c.md");
  });
});
