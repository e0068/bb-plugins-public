// @vitest-environment node
// 21 октября bb на 48 минут потерял способность запускать процессы (spawn
// EBADF), и шаги Flow назвали это по-своему: Commit — «not a git repository»
// про папку, где репозиторий был, «Смёрджить PR» — «git status unavailable
// (unavailable)». Причину владелец мог узнать только из журнала bb. Обещание:
// шаг, которому bb не отдал git-статус окружения, называет папку, код и
// сообщение самого bb.
import { describe, expect, it } from "vitest";

import { gatherAndCreate, type Sdk } from "./shell/pr-helpers";
import { createSteps, type StepPorts } from "./steps";

const EBADF = { outcome: "unavailable", failure: { code: "not_git_repo", message: "spawn EBADF", workspacePath: "/worktrees/thr_x/bb-plugins" } };
const GONE = { outcome: "unavailable", failure: { code: "path_not_found", message: "the folder is gone", workspacePath: "/Projects/Gone" } };

/** Тред `t1` в окружении `e1` с данным ответом статуса. */
const sdk = (status: unknown) =>
  ({
    threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T", titleFallback: "T" }) },
    environments: {
      status: async () => status,
      get: async () => ({ id: "e1", hostId: "h", path: "/worktrees/thr_x/bb-plugins", branchName: "bb/x", mergeBaseBranch: null, defaultBranch: "main", baseBranch: "origin/main" }),
      commit: async () => {
        throw new Error("коммита быть не должно");
      },
    },
  }) as unknown as Sdk;

const kv = { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] } as never;

const ports = (status: unknown): StepPorts => ({
  sdk: sdk(status) as unknown as StepPorts["sdk"],
  kv,
  settings: { get: async () => ({ githubToken: undefined }) },
  sleep: async () => undefined,
});

describe("шаг, которому bb не отдал git-статус окружения", () => {
  it("Commit называет папку, код и сообщение bb, а не «not a git repository»", async () => {
    expect(await createSteps(ports(EBADF))["git.commit"]("t1")).toEqual({
      ok: false,
      error: "Git status of the thread's environment is unavailable (/worktrees/thr_x/bb-plugins, not_git_repo): spawn EBADF",
    });
  });

  it("Commit называет так же и любую другую недоступность статуса", async () => {
    expect(await createSteps(ports(GONE))["git.commit"]("t1")).toEqual({
      ok: false,
      error: "Git status of the thread's environment is unavailable (/Projects/Gone, path_not_found): the folder is gone",
    });
  });

  it("«Открыть PR» и «Смёрджить PR» называют папку, код и сообщение bb вместо «(unavailable)»", async () => {
    await expect(gatherAndCreate(sdk(EBADF), kv, "token", "t1")).rejects.toThrow(
      "Git status of the thread's environment is unavailable (/worktrees/thr_x/bb-plugins, not_git_repo): spawn EBADF",
    );
  });

  it("окружение без git у PR называется папкой и тем, что с ней делать", async () => {
    await expect(gatherAndCreate(sdk({ outcome: "not_applicable", reason: "non_git_environment", message: "" }), kv, "token", "t1")).rejects.toThrow(
      "The thread's environment is not a git repository: /worktrees/thr_x/bb-plugins. Point the project at the folder that holds the repository, then retry.",
    );
  });
});
