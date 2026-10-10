// Contract promises of the backend: what getState hands the sidebar, read
// through the host's own rpc semantics (schema-checked output) against stubbed
// `bb.sdk` calls. The coloring and provider-selection rules themselves are
// pinned in lib/usage-model.test.ts.
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { DEFAULT_LIMITS, moveLimit, toggleLimit, type LimitsChoice, type StateWire } from "./lib/usage-model";
import { DEFAULT_RING_DIMS, type RingDims } from "./lib/ring-style";

/** The live host response, 2026-09-12. */
const LIVE_USAGE = {
  "claude-code": {
    status: "ok",
    accountEmail: "someone@example.com",
    planLabel: "Max (20x)",
    windows: [
      { label: "Current session", usedPercent: 32, resetsAt: "2026-09-12T19:20:00.141Z" },
      { label: "Weekly limit", usedPercent: 85, resetsAt: "2026-09-14T03:00:00.141Z" },
      { label: "Fable", usedPercent: 34, resetsAt: "2026-09-14T03:00:00.141Z" },
    ],
  },
  codex: {
    status: "ok",
    accountEmail: "someone@example.com",
    planLabel: "Plus",
    windows: [
      { label: "Current session", usedPercent: 3, resetsAt: "2026-09-12T22:15:48.000Z" },
      { label: "Weekly limit", usedPercent: 1, resetsAt: "2026-09-19T17:15:48.000Z" },
    ],
  },
  "acp-cursor": { status: "not_installed" },
};

/** The live provider list, narrowed to the fields the backend reads. */
const LIVE_PROVIDERS = [
  { id: "claude-code", displayName: "Claude Code", logoUrl: "/api/v1/system/providers/claude-code/logo?h=138a", strings: { iconTint: { light: "#D97757", dark: "#D97757" } } },
  { id: "codex", displayName: "Codex", logoUrl: "/api/v1/system/providers/codex/logo?h=688b", strings: {} },
];

async function load(options: {
  usage?: () => unknown;
  providers?: () => unknown;
  settings?: Record<string, string | number | boolean>;
} = {}) {
  const { bb, harness } = createFakePluginHost({
    settings: options.settings,
    sdk: {
      system: { usageLimits: options.usage ?? (async () => LIVE_USAGE) },
      providers: { list: options.providers ?? (async () => LIVE_PROVIDERS) },
    },
  });
  await plugin(bb);
  const getState = async () => (await harness.callRpc("getState", null)) as StateWire;
  const setRingDims = async (patch: Partial<RingDims>) => (await harness.callRpc("setRingDims", patch)) as RingDims;
  const resetRingDims = async () => (await harness.callRpc("resetRingDims", null)) as RingDims;
  const setLimits = async (limits: LimitsChoice) => (await harness.callRpc("setLimits", limits)) as LimitsChoice;
  return { harness, getState, setRingDims, resetRingDims, setLimits };
}

describe("getState", () => {
  it("returns claude-code then codex from one usage-limits response", async () => {
    const { getState } = await load();
    const state = await getState();
    expect(state.providers.map((provider) => [provider.id, provider.title])).toEqual([
      ["claude-code", "Claude Code"],
      ["codex", "Codex"],
    ]);
    expect(state.providers[1]!.usage).toEqual({
      status: "ok",
      windows: [
        { label: "Current session", usedPercent: 3, resetsAt: "2026-09-12T22:15:48.000Z" },
        { label: "Weekly limit", usedPercent: 1, resetsAt: "2026-09-19T17:15:48.000Z" },
      ],
    });
  });

  it("calls the usage-limits endpoint once per getState", async () => {
    const { harness, getState } = await load();
    await getState();
    expect(harness.sdk.callsTo("system.usageLimits")).toHaveLength(1);
  });

  it("takes each provider's logo url and tint from the host provider list", async () => {
    const { getState } = await load();
    const [claude, codex] = (await getState()).providers;
    expect(claude).toMatchObject({ logoUrl: "/api/v1/system/providers/claude-code/logo?h=138a", tint: { light: "#D97757", dark: "#D97757" } });
    expect(codex).toMatchObject({ logoUrl: "/api/v1/system/providers/codex/logo?h=688b", tint: null });
  });

  it("falls back to the plain logo path without a tint when the provider list fails", async () => {
    const { getState } = await load({
      providers: async () => {
        throw new Error("provider roster unavailable");
      },
    });
    const [claude, codex] = (await getState()).providers;
    expect(claude).toMatchObject({ logoUrl: "/api/v1/system/providers/claude-code/logo", tint: null });
    expect(codex).toMatchObject({ logoUrl: "/api/v1/system/providers/codex/logo", tint: null });
    expect(claude!.usage.status).toBe("ok");
  });

  it("reports codex as not_installed when the response has no codex entry", async () => {
    const { getState } = await load({ usage: async () => ({ "claude-code": LIVE_USAGE["claude-code"] }) });
    const [claude, codex] = (await getState()).providers;
    expect(claude!.usage.status).toBe("ok");
    expect(codex!.usage).toEqual({ status: "not_installed" });
  });

  it("turns the coloring settings into the coloring the widget reads", async () => {
    const { getState } = await load({
      settings: {
        coloring: "Usage ahead of time",
        usageYellowThreshold: 50,
        usageRedThreshold: 80,
        paceYellowThreshold: 10,
        paceRedThreshold: 40,
      },
    });
    expect((await getState()).coloring).toEqual({ mode: "pace", usage: { yellow: 50, red: 80 }, pace: { yellow: 10, red: 40 } });
  });

  it("declares the eight settings with their defaults, with no ring switches — the footer layout decides which rings show", async () => {
    const { harness, getState } = await load();
    const descriptors = harness.registrations.settingsDescriptors;
    expect(Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, [d.type, d.default]]))).toEqual({
      openOnHover: ["boolean", true],
      coloring: ["select", "Share of limit used"],
      usageYellowThreshold: ["number", 60],
      usageRedThreshold: ["number", 90],
      paceYellowThreshold: ["number", 20],
      paceRedThreshold: ["number", 50],
      logo: ["select", "In the center"],
      layout: ["select", "List"],
    });
    const state = await getState();
    expect(state.openOnHover).toBe(true);
    expect(state.coloring).toEqual({ mode: "usage", usage: { yellow: 60, red: 90 }, pace: { yellow: 20, red: 50 } });
    expect(state.providers.every((provider) => !("toggles" in provider))).toBe(true);
  });
});

describe("ring style", () => {
  it("is the default ring with the logo in the center until anything is tuned", async () => {
    const { getState } = await load();
    expect((await getState()).ring).toEqual({ logo: "center", dims: DEFAULT_RING_DIMS });
  });

  it("puts the logo in the corner when the setting says so", async () => {
    const { getState } = await load({ settings: { logo: "In the corner" } });
    expect((await getState()).ring.logo).toBe("corner");
  });

  it("keeps tuned dimensions, pulled into their sliders' ranges, across getState calls", async () => {
    const { getState, setRingDims } = await load();
    const saved = await setRingDims({ size: 22, outer: 99 });
    expect(saved).toEqual({ ...DEFAULT_RING_DIMS, size: 22, outer: 5 });
    expect((await getState()).ring.dims).toEqual(saved);
  });

  it("keeps every tuned dimension when two windows each tune a different one", async () => {
    const { getState, setRingDims } = await load();
    await setRingDims({ size: 22 });
    await setRingDims({ gap: 2 });
    expect((await getState()).ring.dims).toEqual({ ...DEFAULT_RING_DIMS, size: 22, gap: 2 });
  });

  it("goes back to the defaults on reset", async () => {
    const { getState, setRingDims, resetRingDims } = await load();
    await setRingDims({ size: 22 });
    expect(await resetRingDims()).toEqual(DEFAULT_RING_DIMS);
    expect((await getState()).ring.dims).toEqual(DEFAULT_RING_DIMS);
  });
});

describe("window layout and limits", () => {
  it("answers the list with every limit shown until the settings say otherwise", async () => {
    const state = await (await load()).getState();
    expect(state.layout).toBe("list");
    expect(state.limits).toEqual(DEFAULT_LIMITS);
  });

  it("answers the layout picked in the settings", async () => {
    const { getState } = await load({ settings: { layout: "All limits" } });
    expect((await getState()).layout).toBe("all");
  });

  it("keeps the limits picked and their order across getState calls", async () => {
    const { getState, setLimits } = await load();
    const picked = toggleLimit(moveLimit(DEFAULT_LIMITS, "codex-session", -1), "claude-fable");
    expect(await setLimits(picked)).toEqual(picked);
    expect((await getState()).limits).toEqual(picked);
  });
});
