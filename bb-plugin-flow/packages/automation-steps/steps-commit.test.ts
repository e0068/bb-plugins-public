import { describe, expect, it } from "vitest";

import { isStepId, STEP_LABELS } from "./catalog";
import { createSteps, type StepPorts } from "./steps";

/** SDK треда с окружением: `dirty` — есть ли что коммитить; вызовы commit пишутся. */
const sdk = (over: { dirty: boolean; environment?: boolean; commit?: () => Promise<unknown> }) => {
  const commits: string[] = [];
  const api = {
    threads: { get: async () => ({ id: "t1", environmentId: over.environment === false ? null : "e1", title: "T" }) },
    environments: {
      status: async () => ({ outcome: "available", workspace: { workingTree: { hasUncommittedChanges: over.dirty } } }),
      commit:
        over.commit ??
        (async ({ environmentId }: { environmentId: string }) => {
          commits.push(environmentId);
          return { ok: true, action: "commit", commitSha: "abc", commitSubject: "Flow — шаг Commit", message: "" };
        }),
    },
  } as unknown as StepPorts["sdk"];
  return { api, commits };
};

const ports = (api: StepPorts["sdk"]): StepPorts => ({
  sdk: api,
  kv: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] } as unknown as StepPorts["kv"],
  settings: { get: async () => ({ githubToken: undefined }) },
});

describe("шаг Commit", () => {
  it("есть в каталоге с подписью Commit", () => {
    expect(isStepId("git.commit")).toBe(true);
    expect(STEP_LABELS["git.commit"]).toEqual({ en: "Commit", ru: "Commit" });
  });

  it("незакоммиченные правки коммитит в окружении треда и называет тему коммита", async () => {
    const { api, commits } = sdk({ dirty: true });
    expect(await createSteps(ports(api))["git.commit"]("t1")).toEqual({ ok: true, detail: "Flow — шаг Commit" });
    expect(commits).toEqual(["e1"]);
  });

  it("чистое дерево — шаг проходит без коммита", async () => {
    const { api, commits } = sdk({ dirty: false });
    expect(await createSteps(ports(api))["git.commit"]("t1")).toEqual({ ok: true, detail: "nothing to commit" });
    expect(commits).toEqual([]);
  });

  it("отказ bb становится провалом шага с его текстом", async () => {
    const { api } = sdk({ dirty: true, commit: async () => Promise.reject(new Error("commit hook failed")) });
    expect(await createSteps(ports(api))["git.commit"]("t1")).toEqual({ ok: false, error: "commit hook failed" });
  });

  it("тред без окружения — провал", async () => {
    const { api } = sdk({ dirty: true, environment: false });
    expect(await createSteps(ports(api))["git.commit"]("t1")).toMatchObject({ ok: false, error: expect.stringContaining("no environment") });
  });
});
