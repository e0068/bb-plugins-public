// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createProgress, registerProgress } from "./progress";
import { createStore } from "./store";
import { priced } from "./priced-fixture";

const THREAD = "thr_criteria";
const settings: StageSettings = { stages: [builtinStage("questions", []), builtinStage("demo", [])], minButtonWidth: 170 };

const host = async (criteria: readonly string[]) => {
  const now = () => "2026-10-10T10:00:00.000Z";
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "N1", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  await store.putThreadCriteria(THREAD, criteria);
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => undefined, criteria: (threadId) => store.getThreadCriteria(threadId) });
  await harness.callAgentTool(ASK_TOOL_NAME, priced({ title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "demo", state: "todo", recommended: true }] } }), { threadId: THREAD });
  return harness;
};

describe("утверждённые пункты в прогрессе треда", () => {
  it("прогресс несёт утверждённые пункты Definition of Done треда", async () => {
    const harness = await host(["Пункт один", "Пункт два"]);
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ criteria: ["Пункт один", "Пункт два"] });
  });

  it("пунктов нет — поля нет", async () => {
    const harness = await host([]);
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).not.toHaveProperty("criteria");
  });
});
