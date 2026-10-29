// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import { DEFAULT_REDUCED_COLORS, type ReducedColors } from "@bb-plugins/reduced-colors";
import type { rpcContract } from "../server";

afterEach(cleanup);

// The scheme choice itself is covered in chart-color-scheme.test.tsx; this block
// is about the gradient colours that the Reduced Colors scheme keeps.
describe("Reduced Colors gradient inside the Chart Colors settings section", () => {
  it("loads the stored gradient and saves an edit of it through the plugin's rpc", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const saved: ReducedColors[] = [];
    const rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {
      loadChartColorScheme: async () => "reduced",
      saveChartColorScheme: async () => ({ ok: true as const }),
      loadReducedColors: async () => ({ ...DEFAULT_REDUCED_COLORS, enabled: true }),
      saveReducedColors: async (value) => {
        saved.push(value);
        return { ok: true as const };
      },
    };
    renderSlot(app.settingsSections.find((section) => section.id === "chart-colors")!, {}, {
      rpc: rpc as PluginRpcTestHandlers<typeof rpcContract>,
    });

    // The light theme's low end typed over the dark theme's high end: a colour the pair does not hold yet.
    const typed = DEFAULT_REDUCED_COLORS.light.low;
    fireEvent.change(await screen.findByRole("textbox", { name: "Dark theme high colour" }), { target: { value: typed } });

    await waitFor(() =>
      expect(saved).toEqual([{ ...DEFAULT_REDUCED_COLORS, enabled: true, dark: { ...DEFAULT_REDUCED_COLORS.dark, high: typed } }]),
    );
  });
});
