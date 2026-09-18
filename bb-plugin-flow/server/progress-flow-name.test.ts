// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_flow_name";
const settings: StageSettings = { stages: [builtinStage("questions", []), builtinStage("demo", [])], minButtonWidth: 170 };

const host = async (flowName: (threadId: string) => string) => {
  const now = () => "2026-09-17T10:00:00.000Z";
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "N1", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  registerProgress(bb, progress, { now, stages: () => settings, flowName, windowCost: async () => undefined });
  await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "demo", state: "todo", recommended: true }] } }, { threadId: THREAD });
  return harness;
};

describe("название flow в прогрессе треда", () => {
  it("прогресс несёт название flow, по которому идёт тред", async () => {
    const harness = await host((threadId) => (threadId === THREAD ? "Быстрый" : "Default"));
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ flowName: "Быстрый" });
  });

  it("переименованный flow виден на следующем чтении", async () => {
    let name = "Старое";
    const harness = await host(() => name);
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ flowName: "Старое" });
    name = "Новое";
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ flowName: "Новое" });
  });
});
