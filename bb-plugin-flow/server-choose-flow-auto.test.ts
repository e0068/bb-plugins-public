// @vitest-environment node
// Тред, созданный с выбором «Автоматически»: в инструкциях хода он получает список flow с описаниями,
// выбирает flow инструментом и сразу получает его этапы.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, AUTO_FLOW, newFlow, NO_FLOW } from "./core/flows";
import { QUICK_STAGES } from "./core/stages-fixtures";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));

/** Плагин с Default и Quick; тред thr_auto — из проекта с «Автоматически», thr_none — из проекта с «Без flow». */
const setup = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  await harness.callRpc("saveFlowSettings", addFlow(current, { ...newFlow("quick", "Quick"), description: "Мелкие правки", stages: QUICK_STAGES }));
  await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: AUTO_FLOW });
  await harness.callRpc("setFlowChoice", { projectId: "proj_none", flowId: NO_FLOW });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_auto", projectId: "proj_auto", parentThreadId: null }) });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_none", projectId: "proj_none", parentThreadId: null }) });
  const instructions = (threadId: string) => harness.registrations.instructionProvider?.({ threadId, projectId: "proj" }) ?? "";
  return { harness, instructions };
};

describe("выбор flow агентом по «Автоматически»", () => {
  it("выбор «Автоматически» записывается проекту и читается обратно", async () => {
    const { harness } = await setup();
    expect(await harness.callRpc("getFlowChoice", { projectId: "proj_auto" })).toMatchObject({ selected: AUTO_FLOW });
  });

  it("тред с «Автоматически» получает правило выбора с id и описаниями flow, тред с «Без flow» — ничего", async () => {
    const { instructions } = await setup();
    expect(instructions("thr_auto")).toContain(CHOOSE_FLOW_TOOL);
    expect(instructions("thr_auto")).toContain("`quick`");
    expect(instructions("thr_auto")).toContain("Мелкие правки");
    expect(instructions("thr_none")).toBe("");
  });

  it("выбранный flow назначается треду, и его этапы приходят сразу в ответе и дальше в инструкциях", async () => {
    const { harness, instructions } = await setup();
    const answer = text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_auto" }));
    expect(answer).toMatch(/2\. implement/);
    expect(instructions("thr_auto")).toMatch(/2\. implement/);
    expect(instructions("thr_auto")).not.toContain(CHOOSE_FLOW_TOOL);
  });

  it("неизвестный flow не назначается, и правило выбора остаётся", async () => {
    const { harness, instructions } = await setup();
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "gone" }, { threadId: "thr_auto" }))).toMatch(/gone/);
    expect(instructions("thr_auto")).toContain(CHOOSE_FLOW_TOOL);
  });

  it("треду без «Автоматически» инструмент flow не назначает", async () => {
    const { harness, instructions } = await setup();
    expect(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_none" })).toMatchObject({ isError: true });
    expect(instructions("thr_none")).toBe("");
  });
});
