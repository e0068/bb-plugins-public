// @vitest-environment node
// Стык с настоящим git: временный репозиторий в каталоге ОС.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitClient } from "./git-client";
import { readExecutablePaths } from "./file-modes";

// Утёкшие переменные git окружения треда направили бы команды в чужой репозиторий.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const repo = () => {
  const path = mkdtempSync(join(tmpdir(), "file-modes-"));
  dirs.push(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "core.hooksPath", "/dev/null");
  git(path, "config", "core.fileMode", "true");
  return path;
};

describe("readExecutablePaths", () => {
  it("names the files git keeps as executable, and only them", async () => {
    const path = repo();
    writeFileSync(join(path, "shell.command"), "#!/usr/bin/env bash\n");
    chmodSync(join(path, "shell.command"), 0o755);
    writeFileSync(join(path, "readme.md"), "hi\n");
    git(path, "add", ".");
    expect(await readExecutablePaths(gitClient(path))).toEqual(new Set(["shell.command"]));
  });

  it("git fails — an error with git's message, not an empty set that would drop every executable bit", async () => {
    const path = mkdtempSync(join(tmpdir(), "file-modes-nogit-"));
    dirs.push(path);
    await expect(readExecutablePaths(gitClient(path))).rejects.toThrow(/file modes/);
  });
});
