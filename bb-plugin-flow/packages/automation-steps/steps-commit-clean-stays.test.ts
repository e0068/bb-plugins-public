// Отвод своей ветки — только когда есть что коммитить: чистый чекаут на main шаги не переключают, и «Открыть PR» потом
// отказывает понятной причиной, а не увозит в PR всё, что лежит в main сверх origin.
import { describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "./steps";

describe("Commit на чистом дереве", () => {
  it("коммитить нечего — ветка не отводится", async () => {
    const asked: string[] = [];
    const steps = createSteps({
      sdk: {
        threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T" }) },
        environments: { status: async () => ({ outcome: "available", workspace: { workingTree: { hasUncommittedChanges: false } } }) },
      } as unknown as StepPorts["sdk"],
      kv: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] } as unknown as StepPorts["kv"],
      settings: { get: async () => ({ githubToken: undefined }) },
      plugins: {} as StepPorts["plugins"],
      ownPluginId: "flow",
      branchOff: async (threadId) => {
        asked.push(threadId);
        return "bb/flow-t1";
      },
    });
    expect(await steps["git.commit"]("t1")).toEqual({ ok: true, detail: "nothing to commit" });
    expect(asked).toEqual([]);
  });
});
