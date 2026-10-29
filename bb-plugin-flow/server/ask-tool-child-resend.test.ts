// @vitest-environment node
// Повторный бриф запуска потомка после отката доходит до родителя репликой, как и первый (BBPL-994).
// Живой случай — BBPL-942: ответ родителя снял Утверждение из прогона, повторный бриф вышел решённым агентом, и реплики родителю не было.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { CHILD_ANSWER_TOOL } from "./child-answer-tool";
import { createProgress } from "./progress";
import { createStore } from "./store";

const CHILD = "thr_child";
const PARENT = "thr_parent";
const settings: StageSettings = {
  stages: [builtinStage("criteria", []), builtinStage("select", ["criteria"]), builtinStage("approve", ["criteria", "select"]), stage("implement", { skill: "code-standards-fp", name: "Implementation" }), builtinStage("demo", ["criteria", "select", "approve"])],
  minButtonWidth: 190,
};
const [criteria, select, approve, , demo] = settings.stages.map((s) => s.id);
const resent = {
  title: "Выбор этапов после отката",
  setup: {
    criteria: [{ text: "Демонстрация проходит", add: { target: 1, max: 2, risk: 1, minutes: 10 } }],
    stages: [
      { id: criteria, state: "todo" },
      { id: select, state: "todo" },
      { id: approve, state: "todo" },
      { id: "implement", state: "todo", recommended: true, share: { percent: 100, risk: 0 } },
      { id: demo, state: "todo", recommended: true },
    ],
  },
};

describe("повторный бриф запуска потомка", () => {
  it("Утверждение снято из прогона — бриф решён агентом, а родитель всё равно получает реплику с ним", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    const progress = createProgress(bb.storage.kv);
    await store.markLaunched(CHILD);
    await progress.update(CHILD, (p) => ({ ...p, stages: { ...p.stages, [approve!]: { skipped: true } } }));
    const told: Array<{ parentId: string; text: string }> = [];
    registerAskTool(bb, store, {
      newId: () => "C2",
      now: () => "2026-10-28T09:10:00.000Z",
      stages: () => settings,
      progress,
      parentOf: async (id) => (id === CHILD ? PARENT : null),
      tellParent: async (parentId, text) => void told.push({ parentId, text }),
    });
    const result = JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, resent, { threadId: CHILD }));
    expect(result).not.toContain("not accepted");
    expect((await store.getBrief("dec_C2"))?.settle).toBe("agent");
    expect(told.map((t) => t.parentId)).toEqual([PARENT]);
    expect(told[0]!.text).toContain("dec_C2");
    expect(told[0]!.text).toContain(CHILD_ANSWER_TOOL);
    expect(result).toContain("the parent's answer may arrive along the way");
  });
});
