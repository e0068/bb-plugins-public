// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_flow_name";

const settings: StageSettings = { stages: [stage("task", { name: "Задача" })], minButtonWidth: 170 };

const host = (flowName: { current: string | undefined }) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "N1", now: () => "2026-09-24T10:00:00.000Z", stages: () => settings, flowName: () => flowName.current });
  const ask = () => harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "task", state: "todo", recommended: true }] } }, { threadId: THREAD });
  return { ask, store };
};

describe("ask_decision запоминает название flow", () => {
  it("бриф с этапами хранит название flow треда на момент брифа; переименование flow его не меняет", async () => {
    const flowName = { current: "Code" as string | undefined };
    const { ask, store } = host(flowName);
    await ask();
    flowName.current = "Код";
    expect((await store.getBrief("dec_N1"))?.stages?.flowName).toBe("Code");
  });

  it("тред без названия flow — в брифе названия нет", async () => {
    const { ask, store } = host({ current: undefined });
    await ask();
    const brief = await store.getBrief("dec_N1");
    expect(brief?.stages).toBeDefined();
    expect(brief?.stages && "flowName" in brief.stages).toBe(false);
  });
});
