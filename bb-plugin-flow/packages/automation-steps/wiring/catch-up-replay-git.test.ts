// @vitest-environment node
// Стык с настоящим git на том, ради чего задача и заведена: ветка, чей PR уже
// влит одним чужим коммитом, и которая после этого поработала дальше.
// База зовётся `trunk`, а не `main`: коммит в main локальной копии запрещён
// хуком владельца, и тест ловил бы его, а не свой предмет.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCatchUp } from "./catch-up";
import { gitClient } from "./git-client";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string, text: string, message = `${file}: ${text.split("\n")[0]}`) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", message);
};
const read = (cwd: string, file: string) => readFileSync(join(cwd, file), "utf8");

/** origin с trunk, рабочая ветка треда и вторая копия, которая двигает trunk. */
const repos = () => {
  const root = mkdtempSync(join(tmpdir(), "catch-up-replay-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "trunk", origin);
  // Глобальные хуки владельца запрещают коммит в локальной копии — временный
  // репозиторий теста ими не защищают, иначе тест ловит хук, а не свой предмет.
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
  commit(seed, "a.ts", "one\ntwo\n");
  git(seed, "push", "-q", "origin", "trunk");
  const branch = clone("branch");
  git(branch, "checkout", "-q", "-b", "work");
  const integration = clone("integration");
  return { branch, integration };
};

/** Мёрдж PR так, как его делает плагин: содержимое ветки приезжает в базу ЧУЖИМ коммитом, которого у ветки нет. */
const mergeAsPlugin = (integration: string, content: string) => {
  git(integration, "pull", "-q", "origin", "trunk");
  // Сообщение своё: иначе коммит совпал бы с коммитом ветки до последнего
  // байта и получил бы тот же SHA — git склеил бы их, и сцены, ради которой
  // тест написан, не вышло бы.
  commit(integration, "a.ts", content, "Merge pull request #1");
  git(integration, "push", "-q", "origin", "trunk");
};

const base = { mode: "origin", statusBase: "origin/trunk", githubBase: "trunk" } as const;

describe("runCatchUp на ветке, чей PR уже влит", () => {
  it("ветка, поработавшая после мёрджа, переносит на базу только новую работу — без конфликта сама с собой", async () => {
    const { branch, integration } = repos();
    commit(branch, "a.ts", "one\nTWO\n");
    mergeAsPlugin(integration, "one\nTWO\n");
    commit(branch, "a.ts", "one\nTHREE\n");

    expect(await runCatchUp(gitClient(branch), base)).toBe("replay-onto-base");
    expect(read(branch, "a.ts")).toBe("one\nTHREE\n");
    // Ветка теперь стоит на базе: следующее подтягивание — обычная перемотка.
    expect(git(branch, "rev-list", "--count", "origin/trunk..HEAD")).toBe("1");
    expect(git(branch, "merge-base", "HEAD", "origin/trunk")).toBe(git(branch, "rev-parse", "origin/trunk"));
    expect(await runCatchUp(gitClient(branch), base)).toBe("up-to-date");
  });

  it("ветка, которая после мёрджа ничего не делала, доводится до базы", async () => {
    const { branch, integration } = repos();
    commit(branch, "a.ts", "one\nTWO\n");
    mergeAsPlugin(integration, "one\nTWO\n");

    expect(await runCatchUp(gitClient(branch), base)).toBe("reset-to-base");
    expect(read(branch, "a.ts")).toBe("one\nTWO\n");
    expect(git(branch, "rev-list", "--count", "origin/trunk..HEAD")).toBe("0");
  });

  it("чужая работа в базе доезжает до ветки вместе с переносом", async () => {
    const { branch, integration } = repos();
    commit(branch, "a.ts", "one\nTWO\n");
    mergeAsPlugin(integration, "one\nTWO\n");
    commit(integration, "b.ts", "other work\n");
    git(integration, "push", "-q", "origin", "trunk");
    commit(branch, "a.ts", "one\nTHREE\n");

    expect(await runCatchUp(gitClient(branch), base)).toBe("replay-onto-base");
    expect(read(branch, "b.ts")).toBe("other work\n");
    expect(read(branch, "a.ts")).toBe("one\nTHREE\n");
  });

  it("ветка, ничего общего с базой не имеющая, идёт прежним слиянием", async () => {
    const { branch, integration } = repos();
    commit(branch, "a.ts", "one\nBRANCH\n");
    commit(integration, "c.ts", "unrelated\n");
    git(integration, "push", "-q", "origin", "trunk");

    expect(await runCatchUp(gitClient(branch), base)).toBe("merged");
    expect(read(branch, "a.ts")).toBe("one\nBRANCH\n");
    expect(read(branch, "c.ts")).toBe("unrelated\n");
  });
});
