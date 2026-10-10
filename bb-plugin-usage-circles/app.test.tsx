// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "./server";
import { DEFAULT_COLORING, DEFAULT_LIMITS, FOOTER_RINGS, type StateWire } from "./lib/usage-model";
import { DEFAULT_RING_DIMS, DEFAULT_RING_STYLE } from "./lib/ring-style";
import { publishRingStyle } from "./lib/footer-items";

afterEach(() => {
  cleanup();
  publishRingStyle(DEFAULT_RING_STYLE);
});

const app = await loadPluginApp(() => import("./app"));

/** The backend: `getState` answers `state`, the ring calls echo what they store. */
const backend = (state: StateWire): RenderSlotOptions<typeof rpcContract> => ({
  rpc: {
    getState: async () => state,
    setRingDims: async (patch) => ({ ...DEFAULT_RING_DIMS, ...patch }),
    resetRingDims: async () => DEFAULT_RING_DIMS,
    setLimits: async (limits) => limits,
  },
});

const STATE: StateWire = {
  openOnHover: false,
  coloring: DEFAULT_COLORING,
  providers: [
    {
      id: "claude-code",
      title: "Claude Code",
      logoUrl: "/claude",
      tint: null,
      usage: { status: "ok", windows: [{ label: "Current session", usedPercent: 40, resetsAt: null }] },
    },
  ],
  ring: DEFAULT_RING_STYLE,
  layout: "list",
  limits: DEFAULT_LIMITS,
};

describe("Usage Circles app", () => {
  it("puts each limit window into the sidebar footer as its own item with a window, and one more item for every limit", () => {
    expect(app.experimentalSidebarFooterItems.map(({ id, kind }) => `${id}:${kind}`)).toEqual([
      ...FOOTER_RINGS.map(({ id }) => `${id}:disclosure`),
      "usage-limits:disclosure",
    ]);
    expect(app.experimentalSidebarFooterItems.map(({ label }) => label)).toEqual([...FOOTER_RINGS.map(({ label }) => label), "Usage Limits"]);
  });

  it("gives every item its own ring icon", () => {
    const names = app.experimentalSidebarFooterItems.map(({ icon }) => icon);
    expect(new Set(names).size).toBe(FOOTER_RINGS.length + 1);
    expect(app.icons.map(({ name }) => name).sort()).toEqual([...names].sort());
  });

  it("no longer writes a strip of rings into the footer by hand", () => {
    expect(app.contentScripts).toEqual([]);
  });

  it("feeds the rings from getState through its invisible overlay", async () => {
    const overlay = app.appOverlays.find(({ id }) => id === "usage-feed")!;
    const slot = renderSlot(overlay, {}, backend(STATE));
    const Icon = app.icons.find(({ name }) => name.endsWith("claude-session"))!.component;
    const icon = render(<Icon />);
    await waitFor(() => expect(icon.container.querySelector("svg.usage-circles__ring")?.getAttribute("data-tier")).toBe("blue"));
    expect(slot.inspection.rpcCalls.some(({ method }) => method === "getState")).toBe(true);
  });

  it("draws the rings in the style getState hands over", async () => {
    const overlay = app.appOverlays.find(({ id }) => id === "usage-feed")!;
    const corner: StateWire = { ...STATE, ring: { logo: "corner", dims: { ...DEFAULT_RING_DIMS, size: 20 } } };
    renderSlot(overlay, {}, backend(corner));
    const Icon = app.icons.find(({ name }) => name.endsWith("claude-session"))!.component;
    const icon = render(<Icon />);
    await waitFor(() => expect(icon.container.querySelector("svg.usage-circles__ring")?.getAttribute("viewBox")).toBe("0 0 20 20"));
    expect(icon.container.querySelector("[data-provider-badge]")).not.toBeNull();
  });

  it("adds a Ring section to the plugin's settings that stores a tuned dimension", async () => {
    const section = app.settingsSections.find(({ id }) => id === "ring")!;
    expect(section.title).toBe("Ring");
    const slot = renderSlot(section, {}, backend(STATE));
    fireEvent.click(await slot.findByRole("button", { name: "Fine-tune ring" }));
    fireEvent.keyDown(slot.getAllByRole("slider")[0]!, { key: "ArrowRight" });
    await waitFor(() => expect(slot.inspection.rpcCalls.find(({ method }) => method === "setRingDims")?.input).toEqual({ size: 29 }));
  });

  it("hides the footer items the picked layout does not use", () => {
    const overlay = app.appOverlays.find(({ id }) => id === "usage-feed")!;
    const all = renderSlot(overlay, {}, { ...backend(STATE), settings: { layout: "All limits" } });
    expect(all.container.querySelector("style")?.textContent).toContain("plugin:usage-circles/claude-session");
    cleanup();
    const list = renderSlot(overlay, {}, backend(STATE));
    expect(list.container.querySelector("style")).toBeNull();
  });

  it("adds a Limits section to the plugin's settings that stores the limits picked", async () => {
    const section = app.settingsSections.find(({ id }) => id === "limits")!;
    expect(section.title).toBe("Limits");
    const slot = renderSlot(section, {}, backend(STATE));
    fireEvent.click(await slot.findByRole("switch", { name: "Show Codex — weekly limit" }));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.find(({ method }) => method === "setLimits")?.input).toEqual(
        DEFAULT_LIMITS.map((limit) => (limit.id === "codex-weekly" ? { ...limit, shown: false } : limit)),
      ),
    );
  });
});
