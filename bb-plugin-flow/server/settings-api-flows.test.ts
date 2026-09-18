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
  it("getFlowSettings отдаёт текущую коллекцию", async () => {
    const { harness, settings } = await setup();
    expect(await harness.callRpc("getFlowSettings", {})).toEqual(settings.current());
  });

  it("saveFlowSettings не принимает коллекцию без flow", async () => {
    const { harness } = await setup();
    await expect(harness.callRpc("saveFlowSettings", { flows: [], minButtonWidth: 170 })).rejects.toThrow();
  });

  it("getStageCatalog отдаёт каталог", async () => {
    const { harness } = await setup();
    expect(await harness.callRpc("getStageCatalog", {})).toEqual({ skills: [{ name: "spec" }], executors: [] });
  });
});
