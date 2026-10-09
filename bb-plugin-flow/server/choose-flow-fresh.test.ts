// @vitest-environment node
// Выбор flow, после которого тред начинается заново: агент получает не этапы, а просьбу закончить ход — работа начнётся
// заново в новой сессии. Без новой сессии ответ, как раньше, несёт этапы.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { AGENT_NO_FLOW, AUTO_FLOW, NO_FLOW } from "../core/flows";
import { CHOOSE_FLOW_TOOL } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";
import { FRESH_SESSION_REPLY, registerChooseFlow } from "./choose-flow";
import type { FlowSettingsStore } from "./flow-settings";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));

const setup = (fresh: boolean) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const flows = new Map<string, string>([["thr", AUTO_FLOW]]);
  const refused: string[] = [];
  registerChooseFlow(bb, {
    flows: { current: () => ({ flows: [{ id: "plugin", name: "Plugin", stages: [], limitSkills: true }] }) as unknown as FlowSettings } as FlowSettingsStore,
    threads: { flowOf: (threadId) => flows.get(threadId), assign: async (threadId, flowId) => void flows.set(threadId, flowId), takePicked: async () => undefined },
    instructions: () => "1. brief",
    started: async () => undefined,
    fresh: async () => fresh,
    refused: async (threadId) => void refused.push(threadId),
  });
  return { harness, flows, refused };
};

describe("выбор flow перед новой сессией", () => {
  it("Flow начнёт новую сессию — агент назначает flow и получает просьбу закончить ход", async () => {
    const { harness, flows } = setup(true);
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "plugin" }, { threadId: "thr" }))).toContain(FRESH_SESSION_REPLY);
    expect(flows.get("thr")).toBe("plugin");
  });

  it("новой сессии не будет — ответ несёт этапы flow", async () => {
    const { harness } = setup(false);
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "plugin" }, { threadId: "thr" }))).toContain("1. brief");
  });

  it("отказ от flow в сессии, начатой с ограничением, — тоже новая сессия: в ней навыки вернутся", async () => {
    const { harness, flows } = setup(true);
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: NO_FLOW }, { threadId: "thr" }))).toContain(FRESH_SESSION_REPLY);
    expect(flows.get("thr")).toBe(AGENT_NO_FLOW);
  });

  it("отказ от flow без новой сессии — тред идёт без flow в этой же сессии", async () => {
    const { harness } = setup(false);
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: NO_FLOW }, { threadId: "thr" }))).toContain("stays without a flow");
  });

  it("отказ от flow сверяет настройки треда: спрятанное до выбора возвращается", async () => {
    const { harness, refused } = setup(false);
    await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: NO_FLOW }, { threadId: "thr" });
    expect(refused).toEqual(["thr"]);
  });
});
