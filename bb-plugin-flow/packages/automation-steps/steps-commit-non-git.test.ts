import { describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "./steps";

/** Окружение треда с данным ответом статуса; путь папки окружения — `/Projects/Shapeshift`. */
const ports = (status: unknown): StepPorts => ({
  sdk: {
    threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T" }) },
    environments: {
      status: async () => status,
      get: async () => ({ id: "e1", path: "/Projects/Shapeshift" }),
      commit: async () => {
        throw new Error("коммита быть не должно");
      },
    },
  } as unknown as StepPorts["sdk"],
  kv: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] } as unknown as StepPorts["kv"],
  settings: { get: async () => ({ githubToken: undefined }) },
  sleep: async () => undefined,
});

describe("шаг Commit в окружении без git", () => {
  it("называет папку окружения и что с ней делать, а не «not_applicable»", async () => {
    const outcome = await createSteps(ports({ outcome: "not_applicable", reason: "non_git_environment", message: "" }))["git.commit"]("t1");
    expect(outcome).toEqual({
      ok: false,
      error: "The thread's environment is not a git repository: /Projects/Shapeshift. Point the project at the folder that holds the repository, then retry.",
    });
  });

  it("папка без репозитория по отказу bb называется так же, с путём из отказа", async () => {
    const outcome = await createSteps(ports({ outcome: "unavailable", failure: { code: "not_git_repo", message: "not a git repository", workspacePath: "/Projects/Other" } }))["git.commit"]("t1");
    expect(outcome).toEqual({
      ok: false,
      error: "The thread's environment is not a git repository: /Projects/Other. Point the project at the folder that holds the repository, then retry.",
    });
  });

  it("другая недоступность статуса называет причину bb и папку", async () => {
    const outcome = await createSteps(ports({ outcome: "unavailable", failure: { code: "path_not_found", message: "the folder is gone", workspacePath: "/Projects/Gone" } }))["git.commit"]("t1");
    expect(outcome).toEqual({ ok: false, error: "Git status of the thread's environment is unavailable (/Projects/Gone): the folder is gone" });
  });
});
