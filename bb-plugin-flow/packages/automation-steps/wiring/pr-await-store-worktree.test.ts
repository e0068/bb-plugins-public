// @vitest-environment node
// Отметка «ждёт» пишется залпом опроса по всем строкам разом и из двух
// плагинов; общий конфиг репозитория такого не выдерживает — git отвечает
// «could not lock config file». Здесь — обещания хранилища на настоящих
// рабочих деревьях во временном каталоге ОС.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AwaitMark } from "../core/pr-await";
import { gitClient } from "./git-client";
import { readMark, writeMark } from "./pr-await-store";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Основная копия с коммитом и два рабочих дерева тредов на своих ветках. */
const repos = () => {
  const root = mkdtempSync(join(tmpdir(), "pr-await-wt-"));
  dirs.push(root);
  const main = join(root, "main");
  git(root, "init", "-q", "-b", "main", main);
  git(main, "config", "core.hooksPath", "/dev/null");
  git(main, "config", "user.email", "t@t");
  git(main, "config", "user.name", "t");
  writeFileSync(join(main, "a.md"), "a\n");
  git(main, "add", "a.md");
  git(main, "commit", "-q", "-m", "a");
  const tree = (branch: string, name: string) => {
    const path = join(root, name);
    git(main, "worktree", "add", "-q", "-b", branch, path);
    return path;
  };
  return { main, one: tree("bb/thr_one", "one"), two: tree("bb/thr_two", "two") };
};

const mark = (since: number): AwaitMark => ({ kind: "publish", since, askedAt: null, found: null });

describe("pr-await-store на рабочих деревьях", () => {
  it("залп параллельных записей в одно дерево не теряет ни одной: каждая завершилась, прочитана одна из записанных", async () => {
    const { one } = repos();
    const written = Array.from({ length: 30 }, (_, i) => mark(1_790_000_000_000 + i));
    await Promise.all(written.map((m) => writeMark(gitClient(one), "bb/thr_one", m)));
    expect(written).toContainEqual(await readMark(gitClient(one), "bb/thr_one"));
  });

  it("параллельные записи в разные деревья не мешают друг другу", async () => {
    const { one, two } = repos();
    await Promise.all(Array.from({ length: 15 }, (_, i) => [writeMark(gitClient(one), "bb/thr_one", mark(i)), writeMark(gitClient(two), "bb/thr_two", mark(100 + i))]).flat());
    expect((await readMark(gitClient(one), "bb/thr_one"))?.since).toBeLessThan(100);
    expect((await readMark(gitClient(two), "bb/thr_two"))?.since).toBeGreaterThanOrEqual(100);
  });

  it("запись не трогает конфиг репозитория владельца", async () => {
    const { main, one } = repos();
    const before = git(main, "config", "--list", "--local");
    await writeMark(gitClient(one), "bb/thr_one", mark(1));
    expect(git(main, "config", "--list", "--local")).toBe(before);
  });

  it("отметка одной ветки не читается на другой ветке того же дерева", async () => {
    const { one } = repos();
    await writeMark(gitClient(one), "bb/thr_one", mark(1));
    expect(await readMark(gitClient(one), "bb/thr_other")).toBeNull();
  });
});
