// @vitest-environment node
// Тред, который агент сам оставил без flow, не запирается: владелец просит работать через flow — агент назначает его тем же инструментом.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, AUTO_FLOW, newFlow, NO_FLOW } from "./core/flows";
import { QUICK_STAGES } from "./core/stages-fixtures";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));

/** Тред thr_auto из проекта с «Автоматически», где агент уже отказался от flow; thr_none — «Без flow» владельца. */
const setup = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  await harness.callRpc("saveFlowSettings", addFlow(current, { ...newFlow("quick", "Quick"), description: "Мелкие правки", stages: QUICK_STAGES }));
  await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: AUTO_FLOW });
  await harness.callRpc("setFlowChoice", { projectId: "proj_none", flowId: NO_FLOW });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null }) });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_none", projectId: "proj_none", parentThreadId: null }) });
  await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: NO_FLOW }, { threadId: "thr_auto" });
  const instructions = (threadId: string) => harness.registrations.instructionProvider?.({ threadId, projectId: "proj" }) ?? "";
  return { harness, instructions };
};

describe("тред, оставленный агентом без flow", () => {
  it("получает в ход одну строку: какие flow есть и когда звать инструмент", async () => {
    const { instructions } = await setup();
    expect(instructions("thr_auto")).toContain(CHOOSE_FLOW_TOOL);
    expect(instructions("thr_auto")).toContain("`quick`");
    expect(instructions("thr_auto")).not.toContain("\n");
  });

  it("по просьбе владельца получает flow, и этапы приходят в ответе и дальше в инструкциях", async () => {
    const { harness, instructions } = await setup();
    const answer = await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_auto" });
    expect(answer).not.toMatchObject({ isError: true });
    expect(text(answer)).toMatch(/2\. implement/);
    expect(instructions("thr_auto")).toMatch(/2\. implement/);
  });

  it("выбор «без flow» владельцем по-прежнему заперт и ничего не вкладывает в ход", async () => {
    const { harness, instructions } = await setup();
    expect(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_none" })).toMatchObject({ isError: true });
    expect(instructions("thr_none")).toBe("");
  });
});
