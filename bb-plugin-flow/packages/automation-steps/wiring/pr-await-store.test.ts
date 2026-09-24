// @vitest-environment node
// Стык с настоящим git: отметка живёт в конфиге репозитория, во временном каталоге ОС.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AwaitMark } from "../core/pr-await";
import { gitClient } from "./git-client";
import { readMark, writeMark } from "./pr-await-store";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const BRANCH = "bb/flow-thr_x";
const repo = () => {
  const path = mkdtempSync(join(tmpdir(), "pr-await-"));
  dirs.push(path);
  execFileSync("git", ["init", "-q", "-b", "main", path]);
  return { path, git: gitClient(path) };
};
const MARK: AwaitMark = { kind: "publish", since: 1_790_000_000_000, askedAt: 1_790_000_060_000, found: { number: 41, url: "https://github.com/e0068/bb-plugins/pull/41" } };

describe("pr-await-store", () => {
  it("отметки нет → null", async () => {
    expect(await readMark(repo().git, BRANCH)).toBeNull();
  });

  it("записанная отметка читается обратно", async () => {
    const { git } = repo();
    await writeMark(git, BRANCH, MARK);
    expect(await readMark(git, BRANCH)).toEqual(MARK);
  });

  it("другой клиент того же репозитория видит отметку — так её видят оба плагина", async () => {
    const { path, git } = repo();
    await writeMark(git, BRANCH, MARK);
    expect(await readMark(gitClient(path), BRANCH)).toEqual(MARK);
  });

  it("снятая отметка читается как отсутствие; повторное снятие не падает", async () => {
    const { git } = repo();
    await writeMark(git, BRANCH, MARK);
    await writeMark(git, BRANCH, null);
    expect(await readMark(git, BRANCH)).toBeNull();
    await expect(writeMark(git, BRANCH, null)).resolves.toBeUndefined();
  });

  it("отметки веток не смешиваются", async () => {
    const { git } = repo();
    await writeMark(git, BRANCH, MARK);
    expect(await readMark(git, "bb/other")).toBeNull();
  });

  it("битое значение читается как отсутствие", async () => {
    const { path, git } = repo();
    execFileSync("git", ["config", `branch.${BRANCH}.bbPrAwait`, "nope"], { cwd: path });
    expect(await readMark(git, BRANCH)).toBeNull();
  });
});
