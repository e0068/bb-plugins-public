// @vitest-environment node
// Стык с настоящим git: сведение, которое сорвалось на коммите слияния, отменяет слияние целиком.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CatchUpConflict, runCatchUp } from "./catch-up";
import { gitClient } from "./git-client";
import { treeFiles } from "./tree-files";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (cwd: string, file: string, text: string) => {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), text);
};
const commitAll = (cwd: string, message: string) => {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
};

const TASK = "docs/tasks/backlog/fix-ff.md";
const MOVED = "docs/tasks/in_progress/fix-ff.md";

describe("сведение, сорванное на коммите слияния", () => {
  it("хук отклонил коммит — слияние отменено, ветка и дерево как были, конфликт назван списком", async () => {
    const root = mkdtempSync(join(tmpdir(), "catch-up-hook-"));
    dirs.push(root);
    const origin = join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    const clone = (name: string) => {
      const path = join(root, name);
      git(root, "clone", "-q", origin, path);
      git(path, "config", "core.hooksPath", "/dev/null");
      git(path, "config", "user.email", "t@t");
      git(path, "config", "user.name", "t");
      return path;
    };
    const seed = clone("seed");
    write(seed, ".gitattributes", "docs/tasks/** merge=union\n");
    write(seed, TASK, "---\ntitle: T\nslug: fix-ff\n---\n\nКоротко.\n\n## Comments\n");
    commitAll(seed, "seed");
    git(seed, "push", "-q", "origin", "main");
    const branch = clone("branch");
    git(branch, "checkout", "-q", "-b", "feature");
    mkdirSync(join(branch, "docs/tasks/in_progress"), { recursive: true });
    renameSync(join(branch, TASK), join(branch, MOVED));
    write(branch, MOVED, "---\ntitle: T\nslug: fix-ff\nestimate: l\n---\n\nСовсем другое длинное тело задачи, переписанное в ветке целиком.\n\n## Comments\n");
    commitAll(branch, "take");
    const other = clone("other");
    write(other, TASK, "---\ntitle: T\nslug: fix-ff\nkey: K-1\n---\n\nКоротко.\n\n## Comments\n");
    commitAll(other, "key");
    git(other, "push", "-q", "origin", "main");
    // Хук коммита владельца отклоняет коммит; слияние git его не зовёт, коммит сведённого — зовёт.
    const hooks = join(root, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(hooks, "pre-commit"), 0o755);
    git(branch, "config", "core.hooksPath", hooks);
    const before = git(branch, "rev-parse", "HEAD");
    const failure = await runCatchUp(gitClient(branch), { mode: "origin", statusBase: "origin/main", githubBase: "main" }, treeFiles(branch)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CatchUpConflict);
    expect((failure as CatchUpConflict).files).toContain(TASK);
    expect(existsSync(join(branch, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(branch, "rev-parse", "HEAD")).toBe(before);
    expect(git(branch, "status", "--porcelain")).toBe("");
  });
});
