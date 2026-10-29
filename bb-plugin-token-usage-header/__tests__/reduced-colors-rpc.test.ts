import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { DEFAULT_REDUCED_COLORS, REDUCED_COLORS_KV_KEY, type ReducedColors } from "@bb-plugins/reduced-colors";

import { CHART_COLOR_SCHEME_KV_KEY } from "../src/core";
import plugin from "../server";

async function loadPlugin() {
  const { bb, harness } = createFakePluginHost();
  await plugin(bb, {});
  return { bb, harness };
}

const CUSTOM: ReducedColors = {
  enabled: true,
  light: { low: "#0000ff", high: "#aabbcc" },
  dark: { low: "#112233", high: "#ffffff" },
};

describe("server.ts loadReducedColors / saveReducedColors", () => {
  it("loads the switched-off defaults before anything is saved", async () => {
    const { harness } = await loadPlugin();
    await expect(harness.callRpc("loadReducedColors", {})).resolves.toEqual(DEFAULT_REDUCED_COLORS);
  });

  it("loads back what was saved", async () => {
    const { harness } = await loadPlugin();
    await expect(harness.callRpc("saveReducedColors", CUSTOM)).resolves.toEqual({ ok: true });
    await expect(harness.callRpc("loadReducedColors", {})).resolves.toEqual(CUSTOM);
  });

  it("stores the value in the plugin's kv under the shared key", async () => {
    const { bb, harness } = await loadPlugin();
    await harness.callRpc("saveReducedColors", CUSTOM);
    await expect(bb.storage.kv.get(REDUCED_COLORS_KV_KEY)).resolves.toEqual(CUSTOM);
  });

  it("loads junk in kv as the defaults, keeping whatever part is still valid", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(REDUCED_COLORS_KV_KEY, { enabled: true, light: "blue", dark: { low: "#000000", high: 5 } });
    await expect(harness.callRpc("loadReducedColors", {})).resolves.toEqual({
      enabled: true,
      light: DEFAULT_REDUCED_COLORS.light,
      dark: { low: "#000000", high: DEFAULT_REDUCED_COLORS.dark.high },
    });
  });
});

describe("server.ts loadChartColorScheme / saveChartColorScheme", () => {
  it("loads the palette before anything is chosen or saved", async () => {
    const { harness } = await loadPlugin();
    await expect(harness.callRpc("loadChartColorScheme", {})).resolves.toBe("palette");
  });

  it("loads Reduced Colors for an owner who switched it on before schemes existed", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(REDUCED_COLORS_KV_KEY, CUSTOM);
    await expect(harness.callRpc("loadChartColorScheme", {})).resolves.toBe("reduced");
  });

  it("loads back the scheme that was chosen, stored under its own kv key", async () => {
    const { bb, harness } = await loadPlugin();
    await expect(harness.callRpc("saveChartColorScheme", { scheme: "model" })).resolves.toEqual({ ok: true });
    await expect(harness.callRpc("loadChartColorScheme", {})).resolves.toBe("model");
    await expect(bb.storage.kv.get(CHART_COLOR_SCHEME_KV_KEY)).resolves.toBe("model");
  });

  it("lets a chosen scheme beat the old Reduced Colors switch", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(REDUCED_COLORS_KV_KEY, CUSTOM);
    await harness.callRpc("saveChartColorScheme", { scheme: "palette" });
    await expect(harness.callRpc("loadChartColorScheme", {})).resolves.toBe("palette");
  });

  it("loads an unreadable stored scheme as if none was chosen", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(CHART_COLOR_SCHEME_KV_KEY, "rainbow");
    await expect(harness.callRpc("loadChartColorScheme", {})).resolves.toBe("palette");
  });

  it("refuses a scheme it does not know", async () => {
    const { harness } = await loadPlugin();
    await expect(harness.callRpc("saveChartColorScheme", { scheme: "rainbow" })).rejects.toThrow();
  });

  it("switches the ramp on only under the Reduced Colors scheme, whatever the stored switch says", async () => {
    const { bb, harness } = await loadPlugin();
    await bb.storage.kv.set(REDUCED_COLORS_KV_KEY, CUSTOM);
    await harness.callRpc("saveChartColorScheme", { scheme: "model" });
    await expect(harness.callRpc("loadReducedColors", {})).resolves.toEqual({ ...CUSTOM, enabled: false });
    await harness.callRpc("saveReducedColors", { ...CUSTOM, enabled: false });
    await harness.callRpc("saveChartColorScheme", { scheme: "reduced" });
    await expect(harness.callRpc("loadReducedColors", {})).resolves.toEqual({ ...CUSTOM, enabled: true });
  });
});
