// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings, FLOW_SETTINGS_KEY, LEGACY_STAGE_SETTINGS_KEY } from "./flow-settings";

describe("битая коллекция flow", () => {
  it("запись, не прошедшая схему, не перезаписывается переносом старого списка", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const broken = { flows: [{ id: "quick", name: "Quick", stages: "будущая форма" }], minButtonWidth: 170 };
    await bb.storage.kv.set(FLOW_SETTINGS_KEY, broken);
    await bb.storage.kv.set(LEGACY_STAGE_SETTINGS_KEY, { stages: [], minButtonWidth: 170 });
    const settings = await createFlowSettings(bb.storage.kv);
    expect(settings.current().flows.map((f) => f.id)).toEqual(["default"]);
    expect(await bb.storage.kv.get(FLOW_SETTINGS_KEY)).toEqual(broken);
  });
});
