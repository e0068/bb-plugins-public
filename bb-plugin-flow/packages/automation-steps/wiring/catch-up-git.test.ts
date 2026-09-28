// @vitest-environment node
// Стык с настоящим git: временные репозитории в каталоге ОС, origin — голый репозиторий.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCatchUp } from "./catch-up";
import { gitClient } from "./git-client";

// Утёкшие переменные git окружения треда направили бы команды в чужой репозиторий.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `${file}: ${text}`);
};

/** origin с main, клон-ветка `feature` и второй клон, который двигает main. */
const repos = () => {
  const root = mkdtempSync(join(tmpdir(), "catch-up-"));
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
  commit(seed, "shared.md", "base\n");
  git(seed, "push", "-q", "origin", "main");
  const branch = clone("branch");
  git(branch, "checkout", "-q", "-b", "feature");
  const other = clone("other");
  return { branch, other };
};

const base = { mode: "origin", statusBase: "origin/main", githubBase: "main" } as const;

describe("runCatchUp на настоящем git", () => {
  it("разошедшаяся ветка без конфликтов получает коммит слияния с вершиной main", async () => {
    const { branch, other } = repos();
    commit(branch, "mine.md", "mine\n");
    commit(other, "theirs.md", "theirs\n");
    git(other, "push", "-q", "origin", "main");
    expect(await runCatchUp(gitClient(branch), base)).toBe("merged");
    expect(git(branch, "rev-list", "--count", "HEAD..origin/main")).toBe("0");
    expect(git(branch, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
    expect(git(branch, "status", "--porcelain")).toBe("");
  });

  it("конфликт — ошибка со списком файлов, ветка и дерево как были", async () => {
    const { branch, other } = repos();
    commit(branch, "shared.md", "mine\n");
    commit(other, "shared.md", "theirs\n");
    git(other, "push", "-q", "origin", "main");
    const before = git(branch, "rev-parse", "HEAD");
    await expect(runCatchUp(gitClient(branch), base)).rejects.toThrow(/shared\.md/);
    expect(git(branch, "rev-parse", "HEAD")).toBe(before);
    expect(git(branch, "status", "--porcelain")).toBe("");
  });
});
