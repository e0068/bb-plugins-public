// @vitest-environment node
// Упавшая сверка не обрывает очередь треда: следующая сверка идёт, ошибка уходит в лог, а не в необработанный отказ.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { Flow } from "../shared/contract";
import { createSkillScope } from "./skill-scope";

const FLOW: Flow = { id: "f", name: "F", stages: [{ id: "brief", name: "brief", skill: "flow-questions", executors: [] }], limitSkills: true };

describe("упавшая сверка", () => {
  it("следующая сверка того же треда всё равно идёт, ошибка — в предупреждении", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const warnings: string[] = [];
    let calls = 0;
    const scope = createSkillScope({
      kv: bb.storage.kv,
      worktree: async () => {
        calls += 1;
        if (calls === 1) throw new Error("thread gone");
        return null;
      },
      flow: () => FLOW,
      stages: () => FLOW.stages,
      progress: async () => null,
      catalog: async () => ({ skills: [], executors: [] }),
      plugins: async () => [],
      workflowScripts: async () => [],
      warn: (message) => void warnings.push(message),
    });
    await Promise.all([scope.sync("thr"), scope.sync("thr")]);
    expect(calls).toBe(2);
    expect(warnings).toEqual([expect.stringContaining("thread gone")]);
  });
});
