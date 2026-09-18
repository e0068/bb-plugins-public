// @vitest-environment node
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, DEFAULT_STAGES, newFlow, setFlowStages } from "./core/flows";
import plugin from "./server";

describe("плагин Flow: удалённый flow", () => {
  it("тред, чей flow удалён, идёт по flow по умолчанию — с правилом flow и этапами по умолчанию", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    const settings = await harness.callRpc<{ flows: { id: string }[]; minButtonWidth: number }>("getFlowSettings", {});
    await harness.callRpc("saveFlowSettings", setFlowStages(addFlow(settings as never, newFlow("quick", "Quick")), "quick", (stages) => stages.slice(0, 2)));
    await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: "quick" });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_new", projectId: "proj_a", parentThreadId: null }) });
    const current = await harness.callRpc<{ flows: { id: string }[]; minButtonWidth: number }>("getFlowSettings", {});
    await harness.callRpc("saveFlowSettings", { ...current, flows: current.flows.filter((f) => f.id !== "quick") });
    const instructions = harness.registrations.instructionProvider?.({ threadId: "thr_new", projectId: "proj_a" }) ?? "";
    expect(instructions).toContain(`${DEFAULT_STAGES.length}. ${DEFAULT_STAGES.at(-1)!.id} `);
    expect(instructions).toMatch(/only through its stages/);
  });
});
