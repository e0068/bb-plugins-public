import { describe, expect, it } from "vitest";

import type { ResolvedBase } from "../core/base-branch";
import { checkBranchInMain } from "./branch-in-main";
import type { GitPorts, GitRun } from "./git-run";

const TREE = "83c99fce74321c0bbe9b3c67361a5c41006f43dd";
const OTHER_TREE = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });
const code = (value: number): GitRun => ({ code: value, stdout: "", stderr: "" });

const originMain: ResolvedBase = { mode: "origin", statusBase: "origin/main", githubBase: "main" };
const localMain: ResolvedBase = { mode: "local", statusBase: "main", githubBase: "main" };

/** Записывает argv каждого вызова и отвечает из очереди по порядку. */
function fakeGit(answers: readonly GitRun[]): GitPorts & { calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  return {
    calls,
    async run(args) {
      calls.push([...args]);
      return answers[index++] ?? code(128);
    },
  };
}

describe("checkBranchInMain", () => {
  it("коммит ветки в истории main — «в main», содержимое не меряется", async () => {
    const git = fakeGit([ok(), ok()]);

    expect(await checkBranchInMain(git, originMain)).toBe("in-main");
    expect(git.calls).toEqual([
      ["fetch", "origin", "main"],
      ["merge-base", "--is-ancestor", "HEAD", "origin/main"],
    ]);
  });

  it("коммита нет, но содержимое ветки уже в main (squash, PR через API) — «в main»", async () => {
    const git = fakeGit([ok(), code(1), ok(`${TREE}\n`), ok(`${TREE}\n`)]);

    expect(await checkBranchInMain(git, originMain)).toBe("in-main");
  });

  it("коммита нет и у ветки своё содержимое — «не в main»", async () => {
    const git = fakeGit([ok(), code(1), ok(`${OTHER_TREE}\n`), ok(`${TREE}\n`)]);

    expect(await checkBranchInMain(git, originMain)).toBe("not-in-main");
  });

  it("свежий origin/main берётся один раз — содержимое меряется без второго fetch", async () => {
    const git = fakeGit([ok(), code(1), ok(`${OTHER_TREE}\n`), ok(`${TREE}\n`)]);

    await checkBranchInMain(git, originMain);
    expect(git.calls.filter(([command]) => command === "fetch")).toHaveLength(1);
  });

  it("fetch не удался — проверка не идёт по устаревшей ссылке, ответ «неизвестно»", async () => {
    const git = fakeGit([code(128)]);

    expect(await checkBranchInMain(git, originMain)).toBe("unknown");
    expect(git.calls).toEqual([["fetch", "origin", "main"]]);
  });

  it("git упал на проверке предка — «неизвестно», а не «не в main»", async () => {
    const git = fakeGit([ok(), code(128)]);

    expect(await checkBranchInMain(git, originMain)).toBe("unknown");
  });

  it("предка нет, а измерить содержимое не вышло — «неизвестно»", async () => {
    const git = fakeGit([ok(), code(1), code(128), ok(`${TREE}\n`)]);

    expect(await checkBranchInMain(git, originMain)).toBe("unknown");
  });

  it("локальная база не ходит в сеть и меряет по своей ссылке", async () => {
    const git = fakeGit([ok()]);

    expect(await checkBranchInMain(git, localMain)).toBe("in-main");
    expect(git.calls).toEqual([["merge-base", "--is-ancestor", "HEAD", "main"]]);
  });
});
