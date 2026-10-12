// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "./server";

describe("штатные настройки плагина Flow", () => {
  it("показ выбранного треда — переключатель, выключенный по умолчанию", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.settingsDescriptors.showSelectedThread).toMatchObject({ type: "boolean", default: false });
  });
});
