// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "./server";

describe("штатные настройки плагина Flow", () => {
  it("язык, два порога второй полосы в токенах и предвыбор компактации с жёлтой зоны; RPC страницы Flow и выбора flow зарегистрированы, старых RPC этапов нет", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(Object.keys(harness.registrations.settingsDescriptors)).toEqual(["language", "contextWarnTokens", "contextAlertTokens", "compactPreselect", "collapseThreadsFromRail", "showSelectedThread"]);
    expect(harness.registrations.settingsDescriptors.contextWarnTokens).toMatchObject({ type: "number", default: 250_000 });
    expect(harness.registrations.settingsDescriptors.contextAlertTokens).toMatchObject({ type: "number", default: 400_000 });
    expect(harness.registrations.settingsDescriptors.compactPreselect).toMatchObject({ type: "select", options: ["Never", "In the yellow zone", "In the red zone"], default: "In the yellow zone" });
    expect(harness.registrations.rpcMethods).toEqual(expect.arrayContaining(["getFlowSettings", "saveFlowSettings", "getStageCatalog", "getFlowChoice", "setFlowChoice"]));
    expect(harness.registrations.rpcMethods).not.toContain("getStageSettings");
  });

  it("сворачивание панели тредов из рейла — переключатель, выключенный по умолчанию", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.settingsDescriptors.collapseThreadsFromRail).toMatchObject({ type: "boolean", default: false });
  });

  it("показ выбранного треда — переключатель, выключенный по умолчанию", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.settingsDescriptors.showSelectedThread).toMatchObject({ type: "boolean", default: false });
  });
});
