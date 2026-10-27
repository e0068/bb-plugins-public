import { describe, expect, it } from "vitest";

import type { ResolvedBase } from "../core/base-branch";
import { checkBranchInMain } from "./branch-in-main";
import type { GitPorts, GitRun } from "./git-run";

const MERGED = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const CHANGELOG = "bb-plugin-flow/changelog/zadacha-done.md";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });
const conflict = (stdout = ""): GitRun => ({ code: 1, stdout, stderr: "" });
const failed: GitRun = { code: 128, stdout: "", stderr: "fatal" };

const originMain: ResolvedBase = { mode: "origin", statusBase: "origin/main", githubBase: "main" };

/** Отвечает по команде git, а не по очереди вызовов: порядок шагов внутри проверки — не обещание. */
const gitByCommand = (answers: { mergeTreeNames: GitRun; diff: GitRun }): GitPorts => ({
  async run(args) {
    switch (args[0]) {
      case "fetch":
        return ok();
      case "merge-base":
        return conflict();
      case "merge-tree":
        return answers.mergeTreeNames;
      case "diff":
        return answers.diff;
      default:
        return failed;
    }
  },
});

describe("проверка «код в main» после бампа, который проставил версию только в голове PR", () => {
  it("squash: расходится один пункт ченж-лога, остальное в main — код в main", async () => {
    const git = gitByCommand({
      
      mergeTreeNames: conflict(`${MERGED}\n${CHANGELOG}\n\nCONFLICT (add/add)\n`),
      diff: ok(`${CHANGELOG}\n`),
    });
    expect(await checkBranchInMain(git, originMain)).toBe("in-main");
  });

  it("пункт ченж-лога расходится, и ветка несёт ещё файл кода, которого в main нет — не в main", async () => {
    const git = gitByCommand({
      
      mergeTreeNames: conflict(`${MERGED}\n${CHANGELOG}\n\n`),
      diff: ok(`${CHANGELOG}\npackages/x/code.ts\n`),
    });
    expect(await checkBranchInMain(git, originMain)).toBe("not-in-main");
  });

  it("конфликт в файле кода — не в main", async () => {
    const git = gitByCommand({
      
      mergeTreeNames: conflict(`${MERGED}\npackages/x/code.ts\n\n`),
      diff: ok("packages/x/code.ts\n"),
    });
    expect(await checkBranchInMain(git, originMain)).toBe("not-in-main");
  });

  it("не удалось прочитать различия деревьев — «неизвестно», а не «не в main»", async () => {
    const git = gitByCommand({
      
      mergeTreeNames: conflict(`${MERGED}\n${CHANGELOG}\n\n`),
      diff: failed,
    });
    expect(await checkBranchInMain(git, originMain)).toBe("unknown");
  });

  it("merge-tree упал — «неизвестно»", async () => {
    const git = gitByCommand({  mergeTreeNames: failed, diff: ok() });
    expect(await checkBranchInMain(git, originMain)).toBe("unknown");
  });
});
