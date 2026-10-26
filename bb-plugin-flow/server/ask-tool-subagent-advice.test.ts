// @vitest-environment node
// Бриф с этапами при контексте не ниже жёлтого порога сам рекомендует агента-исполнителя на реализации и тестах.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { planner, stage } from "../core/stages-fixtures";
import type { ContextFillView } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { priced } from "./priced-fixture";
import { createStore } from "./store";

const fill = (usedTokens: number): ContextFillView => ({ share: usedTokens / 1_000_000, usedTokens, windowTokens: 1_000_000, warnTokens: 150_000, alertTokens: 300_000 });
const agent = { ...planner, id: "agent:implementer", name: "implementer" };

const stages = [stage("implement", { skill: "code-standards-fp", executors: [agent] }), stage("spec", { skill: "spec", executors: [agent] })];

const run = async (used: number | null, executor = "self") => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "A1", now: () => "2026-10-26T10:00:00.000Z", stages: () => ({ stages, minButtonWidth: 170 }), context: async () => (used === null ? null : fill(used)) });
  await harness.callAgentTool(ASK_TOOL_NAME, priced({ title: "Бриф", setup: { stages: [{ id: "implement", state: "todo", recommended: true, executor }, { id: "spec", state: "todo" }] } }), { threadId: "thr_1" });
  return (await store.getBrief("dec_A1"))?.setup?.stages ?? [];
};

describe("ask_decision советует субагента при большом контексте", () => {
  it("ниже порога бриф сохраняется как прислан", async () => {
    const [implement] = await run(149_999);
    expect(implement).toMatchObject({ executor: "self" });
    expect(implement?.factors).toBeUndefined();
  });

  it("на пороге ровно реализация получает агента и множитель 0.7, спецификация остаётся", async () => {
    const [implement, spec] = await run(150_000);
    expect(implement).toMatchObject({ executor: "agent:implementer", factors: { "agent:implementer": { factor: 0.7, risk: 0 } } });
    expect(spec).toMatchObject({ executor: "self" });
  });

  it("замера нет — бриф как прислан", async () => {
    expect((await run(null))[0]).toMatchObject({ executor: "self" });
  });

  it("этап, где агент уже выбрал исполнителя, не трогается", async () => {
    expect((await run(400_000, "agent:implementer"))[0]).toMatchObject({ executor: "agent:implementer" });
  });
});
