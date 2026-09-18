// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { newFlow } from "../core/flows";
import { createFlowSettings } from "./flow-settings";
import { registerFlowSettingsApi, STAGE_SETTINGS_CHANNEL } from "./settings-api";

const setup = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const settings = await createFlowSettings(bb.storage.kv);
  registerFlowSettingsApi(bb, settings, { catalog: async () => ({ skills: [{ name: "spec" }], executors: [] }), rootSkill: async () => null, skillFile: async () => null, reveal: async () => ({ revealed: false, error: null }) });
  return { harness, settings };
};

describe("RPC страницы Flow", () => {
  it("saveFlowSettings пишет коллекцию версии 2, отдаёт её и сообщает вкладкам", async () => {
    const { harness, settings } = await setup();
    const next = { flows: [newFlow("default", "Default"), newFlow("quick", "Quick")], minButtonWidth: 220 };
    expect(await harness.callRpc("saveFlowSettings", next)).toEqual({ ...next, version: 2 });
    expect(settings.current()).toEqual({ ...next, version: 2 });
    expect(harness.realtimeSignals.map((s) => s.channel)).toContain(STAGE_SETTINGS_CHANNEL);
  });
});
