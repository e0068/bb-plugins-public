// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import { DEFAULT_REDUCED_COLORS, type ReducedColors } from "@bb-plugins/reduced-colors";
import type { rpcContract } from "../server";

afterEach(cleanup);

describe("Reduced Colors settings section", () => {
  it("is registered on the settings page under its own title", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.settingsSections.find((section) => section.id === "reduced-colors")).toMatchObject({ title: "Reduced Colors" });
  });

  it("loads the stored value and saves the switch through the plugin's rpc", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const saved: ReducedColors[] = [];
    const rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {
      loadReducedColors: async () => DEFAULT_REDUCED_COLORS,
      saveReducedColors: async (value) => {
        saved.push(value);
        return { ok: true as const };
      },
    };
    renderSlot(app.settingsSections.find((section) => section.id === "reduced-colors")!, {}, {
      rpc: rpc as PluginRpcTestHandlers<typeof rpcContract>,
    });

    fireEvent.click(await screen.findByRole("switch", { name: "Use Reduced Colors" }));

    await waitFor(() => expect(saved).toEqual([{ ...DEFAULT_REDUCED_COLORS, enabled: true }]));
  });
});
