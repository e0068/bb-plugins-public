// @vitest-environment node
// Стык с настоящим git: конфликты, которые догоняние ветки сводит само, и те, что отдаёт агенту.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CatchUpConflict, runCatchUp } from "./catch-up";
import { treeFiles } from "./tree-files";
import { gitClient } from "./git-client";

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
const ENTRY = "bb-plugin-flow/changelog/fix-ff.md";

const taskText = (header: string, body: string, comments: string) => `---\n${header}\n---\n\n${body}\n\n## Comments\n${comments}`;
const created = taskText("title: Починить FF\nslug: fix-ff\ntype: feature", "## Проблема\n\nКоротко.", "");

const repos = () => {
  const root = mkdtempSync(join(tmpdir(), "catch-up-resolve-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
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
  write(seed, ".gitattributes", "docs/tasks/** merge=union\n");
  write(seed, TASK, created);
  write(seed, "code.ts", "export const a = 1;\n");
  commitAll(seed, "seed");
  git(seed, "push", "-q", "origin", "main");
  const branch = clone("branch");
  git(branch, "checkout", "-q", "-b", "feature");
  const other = clone("other");
  return { branch, other };
};

const base = { mode: "origin", statusBase: "origin/main", githubBase: "main" } as const;

/** Ветка переносит задачу в работу и переписывает тело; доска в main выдаёт ей ключ и пишет комментарий. */
const moveTaskInBranch = (branch: string) => {
  mkdirSync(join(branch, "docs/tasks/in_progress"), { recursive: true });
  renameSync(join(branch, TASK), join(branch, MOVED));
  write(
    branch,
    MOVED,
    taskText(
      "title: Починить FF\nslug: fix-ff\ntype: feature\nestimate: l\ntaken_by:\n  machine: Mac\n  thread: thr_1\ntaken_by:\n  machine: Mac\n  thread: thr_1",
      "## Проблема\n\nДлинно и подробно, совсем другое тело.\n\n## Готово, когда\n\n- шаг проходит",
      '\n<!-- comment id="c2" kind="agent" author="claude" at="2026-10-01T12:00:00Z" -->\nВзял в работу\n',
    ),
  );
  commitAll(branch, "take the task");
};
const keyTaskInMain = (other: string) => {
  write(other, TASK, taskText("title: Починить FF\nslug: fix-ff\ntype: feature\nkey: BBPL-9\nparent: BBPL-1", "## Проблема\n\nКоротко.", '\n<!-- comment id="c1" kind="user" author="owner" at="2026-10-01T11:00:00Z" -->\nВажно\n'));
  commitAll(other, "board: key");
  git(other, "push", "-q", "origin", "main");
};

describe("догоняние сводит само файлы задач и пункты ченж-лога", () => {
  it("задача, перенесённая в ветке, против ключа в main — слияние закоммичено, файл в папке ветки с ключом, комментариями обеих сторон и без двойных строк шапки", async () => {
    const { branch, other } = repos();
    moveTaskInBranch(branch);
    keyTaskInMain(other);
    expect(await runCatchUp(gitClient(branch), base, treeFiles(branch))).toBe("merged");
    expect(git(branch, "status", "--porcelain")).toBe("");
    expect(git(branch, "rev-list", "--count", "HEAD..origin/main")).toBe("0");
    expect(existsSync(join(branch, TASK))).toBe(false);
    const text = readFileSync(join(branch, MOVED), "utf8");
    expect(text).toContain("key: BBPL-9");
    expect(text).toContain("parent: BBPL-1");
    expect(text).toContain("совсем другое тело");
    expect(text).toContain('comment id="c1"');
    expect(text).toContain('comment id="c2"');
    expect(text.match(/^taken_by:/gm)).toHaveLength(1);
  });

  it("пункт, который Bump уже проставил в main, против того же файла, добавленного в ветке, — оба пункта сохранены, проставленный не переписан", async () => {
    const { branch, other } = repos();
    write(branch, ENTRY, "---\nversion: coming-soon\n---\n\n- ru: Второе\n  en: Second\n");
    commitAll(branch, "entry: second note");
    write(other, ENTRY, "---\nversion: 0.6.70\ndate: 2026-10-01\npr: 600\n---\n\n- ru: Первое\n  en: First\n");
    commitAll(other, "bump");
    git(other, "push", "-q", "origin", "main");
    expect(await runCatchUp(gitClient(branch), base, treeFiles(branch))).toBe("merged");
    expect(git(branch, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(branch, ENTRY), "utf8")).toContain("version: 0.6.70");
    expect(readFileSync(join(branch, ENTRY), "utf8")).not.toContain("Второе");
    expect(readFileSync(join(branch, "bb-plugin-flow/changelog/fix-ff-2.md"), "utf8")).toBe("---\nversion: coming-soon\n---\n\n- ru: Второе\n  en: Second\n");
  });
});

describe("конфликт, который сводит агент", () => {
  it("конфликт в коде рядом с задачей — слияние отменено, ветка не тронута, все файлы названы списком", async () => {
    const { branch, other } = repos();
    moveTaskInBranch(branch);
    write(branch, "code.ts", "export const a = 2;\n");
    commitAll(branch, "code: 2");
    keyTaskInMain(other);
    write(other, "code.ts", "export const a = 3;\n");
    commitAll(other, "code: 3");
    git(other, "push", "-q", "origin", "main");
    const before = git(branch, "rev-parse", "HEAD");
    const failure = await runCatchUp(gitClient(branch), base, treeFiles(branch)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CatchUpConflict);
    expect((failure as CatchUpConflict).files).toEqual(expect.arrayContaining(["code.ts", TASK]));
    expect((failure as Error).message).toMatch(/^code\.ts|docs\/tasks/);
    expect(git(branch, "rev-parse", "HEAD")).toBe(before);
    expect(git(branch, "status", "--porcelain")).toBe("");
  });
});
