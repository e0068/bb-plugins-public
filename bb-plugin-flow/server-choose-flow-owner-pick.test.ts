// @vitest-environment node
// Выбор владельца над композером, сделанный пока агент решает сам, выигрывает у выбора агента: агент получает flow владельца,
// а «Без flow» владельца оставляет тред без flow и без бара.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, AUTO_FLOW, newFlow, NO_FLOW } from "./core/flows";
import { QUICK_STAGES } from "./core/stages-fixtures";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import { registerChooseFlow } from "./server/choose-flow";
import type { FlowSettingsStore } from "./server/flow-settings";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));
const THREAD = "thr_auto";

/** Тред проекта с «Автоматически» в первом ходе: flow ещё выбирает агент, а владелец успел выбрать свой над композером. */
const setup = async (picked: string) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  const withQuick = addFlow(current, { ...newFlow("quick", "Quick"), stages: QUICK_STAGES });
  await harness.callRpc("saveFlowSettings", addFlow(withQuick, { ...newFlow("other", "Other"), stages: QUICK_STAGES }));
  await harness.callRpc("setFlowChoice", { projectId: "proj_auto", flowId: AUTO_FLOW });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: THREAD, projectId: "proj_auto", parentThreadId: null }) });
  await harness.callRpc("pickThreadFlow", { threadId: THREAD, flowId: picked });
  return harness;
};

describe("выбор владельца над композером против выбора агента", () => {
  it("«Без flow» владельца: агент, выбравший flow, получает тред без flow, бара нет", async () => {
    const harness = await setup(NO_FLOW);
    const answer = await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: THREAD });
    expect(answer).not.toMatchObject({ isError: true });
    expect(text(answer)).toMatch(/owner/i);
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toBeNull();
    expect(await harness.callRpc("threadFlowChoice", { threadId: THREAD })).toMatchObject({ selected: NO_FLOW });
  });

  it("flow владельца: агент, выбравший другой, получает flow владельца и его этапы", async () => {
    const harness = await setup("quick");
    const answer = await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "other" }, { threadId: THREAD });
    expect(text(answer)).toMatch(/2\. implement/);
    expect(await harness.callRpc("threadFlowChoice", { threadId: THREAD })).toMatchObject({ selected: "quick" });
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ flowName: "Quick" });
  });

  it("«Автоматически» владельца выбор агенту оставляет", async () => {
    const harness = await setup(AUTO_FLOW);
    await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "other" }, { threadId: THREAD });
    expect(await harness.callRpc("threadFlowChoice", { threadId: THREAD })).toMatchObject({ selected: "other" });
  });
});

describe("выбор владельца снимается, когда достался треду", () => {
  const setupUnit = (picked: string) => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const flows = new Map<string, string>([[THREAD, AUTO_FLOW]]);
    const picks = new Map<string, string>([[THREAD, picked]]);
    registerChooseFlow(bb, {
      flows: { current: () => ({ flows: [{ id: "quick", name: "Quick", stages: [] }] }) as unknown as FlowSettings } as FlowSettingsStore,
      threads: {
        flowOf: (threadId) => flows.get(threadId),
        assign: async (threadId, flowId) => void flows.set(threadId, flowId),
        takePicked: async (threadId) => {
          const found = picks.get(threadId);
          picks.delete(threadId);
          return found;
        },
      },
      instructions: () => "1. brief",
      started: async () => undefined,
    });
    return { harness, flows, picks };
  };

  it("ход владельца после выбора агента уже не находит, что применять", async () => {
    const { harness, flows, picks } = setupUnit(NO_FLOW);
    await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: THREAD });
    expect(flows.get(THREAD)).toBe(NO_FLOW);
    expect(picks.has(THREAD)).toBe(false);
  });

  it("совпавший выбор агента и владельца не называется перебитым", async () => {
    const { harness } = setupUnit("quick");
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: THREAD }))).not.toMatch(/owner/i);
  });
});
