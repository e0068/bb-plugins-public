// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { rampColors, type ReducedColors } from "@bb-plugins/reduced-colors";
import type { rpcContract } from "../server";
import { DEFAULT_VIZ_SETTINGS, type VizSettings } from "../src/core";

afterEach(cleanup);

const THREADS = {
  status: "ready" as const,
  unit: 60,
  threads: [
    {
      session: "sess_aaa111",
      project: "token-usage-header",
      title: "sess_aaa111",
      start: "2026-08-25T09:00:00.000Z",
      end: "2026-08-25T09:05:00.000Z",
      durationSec: 300,
      totalTokens: 7000,
      totalCost: 0.42,
      workflowCount: 0,
      bins: [
        { t: "2026-08-25T09:00:00.000Z", agents: [{ key: "main", total: 3000 }, { key: "tester", total: 500 }] },
        { t: "2026-08-25T09:01:00.000Z", agents: [{ key: "main", total: 1500 }, { key: "code-reviewer", total: 2000 }] },
      ],
      cwd: null,
      gitBranch: null,
      events: [],
      bbProjectId: "bb-proj-1",
      bbProjectName: "Token Usage Header",
      threadId: "thread-aaa",
      bbThreadTitle: "Thread A",
      flowStages: [],
    },
  ],
  agentLabels: {},
  truncated: false,
};

const REDUCED: ReducedColors = {
  enabled: true,
  light: { low: "#0000ff", high: "#ffffff" },
  dark: { low: "#ff0000", high: "#000000" },
};

async function renderFeed(reduced: ReducedColors, viz: VizSettings = DEFAULT_VIZ_SETTINGS) {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
  const rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {
    threadsTimeline: async () => THREADS,
    loadVizSettings: async () => viz,
    saveVizSettings: async () => ({ ok: true as const }),
    loadReducedColors: async () => reduced,
  };
  renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: "" }, {
    rpc: rpc as PluginRpcTestHandlers<typeof rpcContract>,
  });
  await screen.findByText("Thread A");
  fireEvent.click(screen.getByRole("button", { name: "Agent colors" }));
  await screen.findByText("Agent colors");
}

const agentColor = (key: string) => (screen.getByLabelText(`${key} color`) as HTMLInputElement).value;
const agentColors = () => ["main", "code-reviewer", "tester"].map(agentColor);

describe("Reduced Colors on the Usage Analytics feed", () => {
  it("paints agents in legend order with the light theme's ramp while it is on", async () => {
    await renderFeed(REDUCED);
    await waitFor(() => expect(agentColors()).toEqual(rampColors("#0000ff", "#ffffff", 3)));
  });

  it("ignores own agent colours while it is on", async () => {
    const viz = { ...DEFAULT_VIZ_SETTINGS, threads: { ...DEFAULT_VIZ_SETTINGS.threads, agentColors: { main: "#123456" } } };
    await renderFeed(REDUCED, viz);
    await waitFor(() => expect(agentColor("main")).toBe("#0000ff"));
  });

  it("keeps the palette and own agent colours while it is off", async () => {
    const viz = { ...DEFAULT_VIZ_SETTINGS, threads: { ...DEFAULT_VIZ_SETTINGS.threads, agentColors: { main: "#123456" } } };
    await renderFeed({ ...REDUCED, enabled: false }, viz);
    await waitFor(() => expect(agentColor("main")).toBe("#123456"));
    expect(agentColor("code-reviewer")).toBe("#22c55e");
  });
});

describe("Reduced Colors on the Usage Analytics cost summary", () => {
  const NOW = Date.parse("2026-09-03T12:00:00.000Z");
  const projectThread = (name: string, cost: number, start: string) => ({
    ...THREADS.threads[0]!,
    session: `sess_${name}`,
    title: `sess_${name}`,
    start,
    end: start,
    totalCost: cost,
    bins: [{ t: start, agents: [{ key: "main", total: 100 }] }],
    bbProjectId: `bb-${name}`,
    bbProjectName: name,
    threadId: `thread-${name}`,
    bbThreadTitle: `${name} session`,
    flowStages: [],
  });
  // Alphabetically Alpha, Beta, Delta, Gamma; the day window holds three of
  // them, ranked by cost Alpha, Gamma, Delta — Beta is ten days old.
  const SUMMARY = [
    projectThread("Alpha", 6, "2026-09-03T10:00:00.000Z"),
    projectThread("Beta", 9, "2026-08-24T11:00:00.000Z"),
    projectThread("Delta", 1, "2026-09-03T09:00:00.000Z"),
    projectThread("Gamma", 3, "2026-09-03T08:00:00.000Z"),
  ];

  const toRgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
  const legendColor = (name: string) =>
    (screen.getByText(name).closest("button")!.querySelector("span.inline-block") as HTMLElement).style.backgroundColor;

  it("runs the legend from exactly low to exactly high in the window's own order", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const app = await loadPluginApp(() => import("../app"));
      const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
      const rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {
        threadsTimeline: async (input) => {
          const { limit } = input as { limit: number };
          return limit === 100 || limit === 1000 ? { ...THREADS, unit: 3600, threads: SUMMARY } : THREADS;
        },
        loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
        saveVizSettings: async () => ({ ok: true as const }),
        loadReducedColors: async () => REDUCED,
      };
      renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: "" }, {
        rpc: rpc as PluginRpcTestHandlers<typeof rpcContract>,
      });
      await screen.findByText("Alpha session");
      await waitFor(() =>
        expect(["Alpha", "Gamma", "Delta"].map(legendColor)).toEqual(rampColors("#0000ff", "#ffffff", 3).map(toRgb)),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Own agent colours while Reduced Colors is on", () => {
  it("cannot be edited — a pick would land unseen — and the popover says why", async () => {
    await renderFeed(REDUCED);
    await waitFor(() => expect((screen.getByLabelText("main color") as HTMLInputElement).disabled).toBe(true));
    expect(screen.getByText(/Reduced Colors is on/)).toBeTruthy();
  });

  it("stay editable while it is off", async () => {
    await renderFeed({ ...REDUCED, enabled: false });
    expect((screen.getByLabelText("main color") as HTMLInputElement).disabled).toBe(false);
  });
});
