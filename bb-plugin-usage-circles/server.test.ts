// Contract promises of the backend: what getState hands the sidebar, read
// through the host's own rpc semantics (schema-checked output) against stubbed
// `bb.sdk` calls. The coloring and provider-selection rules themselves are
// pinned in lib/usage-model.test.ts.
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import type { StateWire } from "./lib/usage-model";

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
  return { harness, getState };
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

  it("keeps the stored fiveHour, weekly and fable values as the Claude Code toggles", async () => {
    const { getState } = await load({ settings: { fiveHour: false, weekly: true, fable: false } });
    expect((await getState()).providers[0]!.toggles).toEqual({ session: false, weekly: true, fable: false });
  });

  it("reads the Codex toggles from their own settings", async () => {
    const { getState } = await load({ settings: { fiveHour: true, weekly: true, codexFiveHour: true, codexWeekly: false } });
    const codex = (await getState()).providers[1]!;
    expect(codex.toggles.session).toBe(true);
    expect(codex.toggles.weekly).toBe(false);
    expect(codex.toggles.fable).toBeUndefined();
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

  it("declares all eleven settings with their defaults", async () => {
    const { harness, getState } = await load();
    const descriptors = harness.registrations.settingsDescriptors;
    expect(Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, [d.type, d.default]]))).toEqual({
      fiveHour: ["boolean", true],
      weekly: ["boolean", true],
      fable: ["boolean", true],
      codexFiveHour: ["boolean", true],
      codexWeekly: ["boolean", true],
      openOnHover: ["boolean", true],
      coloring: ["select", "Share of limit used"],
      usageYellowThreshold: ["number", 60],
      usageRedThreshold: ["number", 90],
      paceYellowThreshold: ["number", 20],
      paceRedThreshold: ["number", 50],
    });
    const state = await getState();
    expect(state.openOnHover).toBe(true);
    expect(state.coloring).toEqual({ mode: "usage", usage: { yellow: 60, red: 90 }, pace: { yellow: 20, red: 50 } });
  });
});
