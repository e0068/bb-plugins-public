import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { DEFAULT_REDUCED_COLORS, REDUCED_COLORS_KV_KEY, type ReducedColors } from "@bb-plugins/reduced-colors";

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
