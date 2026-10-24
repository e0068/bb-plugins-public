// Тред, стоящий на ветке по умолчанию, перед коммитом уходит на свою ветку: коммит не ложится в main. Проверка — на
// настоящем git во временной папке: незакоммиченная правка уезжает вместе с веткой.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { branchOffDefaultBranch } from "./branch-off";
import type { Sdk } from "./pr-helpers";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "branch-off-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start");
  return dir;
};

const sdkAt = (environment: object | null) =>
  ({
    threads: { get: async () => ({ id: "t1", environmentId: environment === null ? null : "e1" }) },
    environments: { get: async () => environment },
  }) as unknown as Sdk;

describe("branchOffDefaultBranch", () => {
  it("чекаут на main: уводит дерево на bb/flow-<тред>, правка едет с ним", async () => {
    const dir = repo();
    writeFileSync(join(dir, "work.txt"), "правка");
    const sdk = sdkAt({ path: dir, hostId: "h", isGitRepo: true, isWorktree: false, managed: false, branchName: "main", defaultBranch: "main" });
    expect(await branchOffDefaultBranch(sdk)("t1")).toBe("bb/flow-t1");
    expect(git(dir, "branch", "--show-current")).toBe("bb/flow-t1");
    expect(readFileSync(join(dir, "work.txt"), "utf8")).toBe("правка");
  });

  it("своя ветка — ничего не трогает", async () => {
    const dir = repo();
    git(dir, "switch", "-q", "-c", "feature");
    const sdk = sdkAt({ path: dir, hostId: "h", isGitRepo: true, isWorktree: false, managed: false, branchName: "feature", defaultBranch: "main" });
    expect(await branchOffDefaultBranch(sdk)("t1")).toBeNull();
    expect(git(dir, "branch", "--show-current")).toBe("feature");
  });

  it("тред без окружения — ничего не трогает", async () => {
    expect(await branchOffDefaultBranch(sdkAt(null))("t1")).toBeNull();
  });

  it("git отказал — исключение с его текстом", async () => {
    const dir = repo();
    git(dir, "branch", "bb/flow-t1");
    const sdk = sdkAt({ path: dir, hostId: "h", isGitRepo: true, isWorktree: false, managed: false, branchName: "main", defaultBranch: "main" });
    await expect(branchOffDefaultBranch(sdk)("t1")).rejects.toThrow("already exists");
  });
});
