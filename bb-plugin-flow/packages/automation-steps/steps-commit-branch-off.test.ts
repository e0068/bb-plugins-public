// Шаги, которые коммитят, сперва уводят тред с ветки по умолчанию, если исполнитель дал порт отвода; без порта — как раньше.
import { describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "./steps";

const harness = (branchOff: StepPorts["branchOff"]) => {
  const log: string[] = [];
  const ports: StepPorts = {
    sdk: {
      threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T" }) },
      environments: {
        status: async () => ({ outcome: "available", workspace: { workingTree: { hasUncommittedChanges: true } } }),
        commit: async () => {
          log.push("commit");
          return { commitSubject: "Правка" };
        },
      },
    } as unknown as StepPorts["sdk"],
    kv: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] } as unknown as StepPorts["kv"],
    settings: { get: async () => ({ githubToken: undefined }) },
    plugins: {} as StepPorts["plugins"],
    ownPluginId: "flow",
    ...(branchOff === undefined ? {} : { branchOff }),
  };
  return { steps: createSteps(ports), log };
};

describe("Commit и ветка по умолчанию", () => {
  it("уводит тред на свою ветку до коммита и называет её в итоге", async () => {
    const { steps, log } = harness(async () => {
      log.push("branch-off");
      return "bb/flow-t1";
    });
    expect(await steps["git.commit"]("t1")).toEqual({ ok: true, detail: "moved off the default branch to bb/flow-t1; Правка" });
    expect(log).toEqual(["branch-off", "commit"]);
  });

  it("своя ветка — коммит как раньше", async () => {
    const { steps } = harness(async () => null);
    expect(await steps["git.commit"]("t1")).toEqual({ ok: true, detail: "Правка" });
  });

  it("отказ отвода — провал шага, коммита нет", async () => {
    const { steps, log } = harness(async () => Promise.reject(new Error("fatal: a branch named 'bb/flow-t1' already exists")));
    expect(await steps["git.commit"]("t1")).toEqual({ ok: false, error: "fatal: a branch named 'bb/flow-t1' already exists" });
    expect(log).toEqual([]);
  });
});
