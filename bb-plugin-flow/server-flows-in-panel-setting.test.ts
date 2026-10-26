// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "./server";

describe("настройки Flow про список в панели тредов", () => {
  it("язык, пороги, предвыбор компактации, список flow в панели и показ выбранного треда — в этом порядке", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(Object.keys(harness.registrations.settingsDescriptors)).toEqual(["language", "contextWarnTokens", "contextAlertTokens", "compactPreselect", "showFlowsInThreadsPanel", "showSelectedThread"]);
  });

  it("список flow в панели тредов — переключатель, выключенный по умолчанию", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.settingsDescriptors.showFlowsInThreadsPanel).toMatchObject({ type: "boolean", default: false });
  });

  it("сворачивания панели тредов из рейла у Flow больше нет", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.settingsDescriptors).not.toHaveProperty("collapseThreadsFromRail");
  });

  it("пороги второй полосы — в токенах, предвыбор компактации — с жёлтой зоны", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.settingsDescriptors.contextWarnTokens).toMatchObject({ type: "number", default: 150_000 });
    expect(harness.registrations.settingsDescriptors.contextAlertTokens).toMatchObject({ type: "number", default: 300_000 });
    expect(harness.registrations.settingsDescriptors.compactPreselect).toMatchObject({ type: "select", options: ["Never", "In the yellow zone", "In the red zone"], default: "In the yellow zone" });
  });

  it("RPC страницы Flow и выбора flow зарегистрированы, старых RPC этапов нет", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.rpcMethods).toEqual(expect.arrayContaining(["getFlowSettings", "saveFlowSettings", "getStageCatalog", "getFlowChoice", "setFlowChoice"]));
    expect(harness.registrations.rpcMethods).not.toContain("getStageSettings");
  });
});
