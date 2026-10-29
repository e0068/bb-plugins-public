// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { DEFAULT_REDUCED_COLORS } from "@bb-plugins/reduced-colors";
import type { rpcContract } from "../server";
import { DEFAULT_VIZ_SETTINGS, type ChartColorScheme, type VizSettings } from "../src/core";

afterEach(cleanup);

type Rpc = PluginRpcTestHandlers<typeof rpcContract>;

const AGENT_MODELS = { main: "claude-opus-4-8", "code-reviewer": "claude-sonnet-4", tester: "gpt-5-codex" };

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
      activeSec: 300,
      waitingSec: 0,
      totalTokens: 7000,
      totalCost: 0.42,
      workflowCount: 0,
      bins: [
        { t: "2026-08-25T09:00:00.000Z", agents: [{ key: "main", total: 3000 }, { key: "tester", total: 500 }] },
        { t: "2026-08-25T09:01:00.000Z", agents: [{ key: "main", total: 1500 }, { key: "code-reviewer", total: 2000 }] },
      ],
      agentModels: AGENT_MODELS,
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

const rpcWith = (scheme: ChartColorScheme, viz: VizSettings = DEFAULT_VIZ_SETTINGS): Partial<Rpc> => ({
  threadsTimeline: async () => THREADS,
  loadVizSettings: async () => viz,
  saveVizSettings: async () => ({ ok: true as const }),
  loadChartColorScheme: async () => scheme,
  loadReducedColors: async () => ({ ...DEFAULT_REDUCED_COLORS, enabled: scheme === "reduced" }),
});

async function renderFeed(scheme: ChartColorScheme, viz?: VizSettings) {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
  renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: "" }, { rpc: rpcWith(scheme, viz) as Rpc });
  await screen.findByText("Thread A");
  fireEvent.click(screen.getByRole("button", { name: "Agent colors" }));
  await screen.findByText("Agent colors");
}

const legendColor = (key: string) => (screen.getByLabelText(`${key} color`) as HTMLInputElement).value;
const toRgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
const columnsPainted = (hex: string) => document.querySelectorAll(`[style*="background-color: ${toRgb(hex)}"]`).length;

describe("The Usage Analytics feed under the model colour scheme", () => {
  it("paints a Claude agent by its model and an agent of another provider with the palette", async () => {
    await renderFeed("model");
    await waitFor(() => expect(legendColor("main")).toBe("#facc15"));
    expect(legendColor("code-reviewer")).toBe("#f97316");
    expect(legendColor("tester")).toBe("#f59e0b");
  });

  it("paints the chart's columns, not only the legend, by model", async () => {
    await renderFeed("model");
    await waitFor(() => expect(legendColor("main")).toBe("#facc15"));
    expect(columnsPainted("#facc15")).toBeGreaterThan(0);
    expect(columnsPainted("#f97316")).toBeGreaterThan(0);
  });

  it("lets a colour picked in the legend beat the model", async () => {
    const viz = { ...DEFAULT_VIZ_SETTINGS, threads: { ...DEFAULT_VIZ_SETTINGS.threads, agentColors: { main: "#123456" } } };
    await renderFeed("model", viz);
    await waitFor(() => expect(legendColor("main")).toBe("#123456"));
    expect(legendColor("code-reviewer")).toBe("#f97316");
  });

  it("names a thread's agents by that thread's own models — 'main' runs on another model in another thread", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
    const other = {
      ...THREADS.threads[0]!,
      session: "sess_bbb222",
      title: "sess_bbb222",
      bbThreadTitle: "Thread B",
      threadId: "thread-bbb",
      bins: [{ t: "2026-08-25T09:00:00.000Z", agents: [{ key: "main", total: 900 }] }],
      agentModels: { main: "claude-haiku-4-5" },
    };
    const rpc = { ...rpcWith("model"), threadsTimeline: async () => ({ ...THREADS, threads: [THREADS.threads[0]!, other] }) };
    renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: "" }, { rpc: rpc as Rpc });
    await screen.findByText("Thread B");
    await waitFor(() => expect(columnsPainted("#facc15")).toBeGreaterThan(0));
    expect(columnsPainted("#c2410c")).toBeGreaterThan(0);
  });

  it("keeps the palette for every agent under the palette scheme", async () => {
    await renderFeed("palette");
    await waitFor(() => expect(legendColor("main")).toBe("#3b82f6"));
    expect(legendColor("code-reviewer")).toBe("#22c55e");
    expect(columnsPainted("#facc15")).toBe(0);
  });

  it("keeps the palette when the stored scheme cannot be read", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
    const rpc = {
      ...rpcWith("model"),
      loadChartColorScheme: async () => {
        throw new Error("kv unavailable");
      },
    };
    renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: "" }, { rpc: rpc as Rpc });
    await screen.findByText("Thread A");
    fireEvent.click(screen.getByRole("button", { name: "Agent colors" }));
    await waitFor(() => expect(legendColor("main")).toBe("#3b82f6"));
  });
});

describe("The chart colours settings section", () => {
  async function renderSection(stored: ChartColorScheme) {
    const app = await loadPluginApp(() => import("../app"));
    const saved: ChartColorScheme[] = [];
    const rpc: Partial<Rpc> = {
      loadChartColorScheme: async () => stored,
      saveChartColorScheme: async ({ scheme }) => {
        saved.push(scheme);
        return { ok: true as const };
      },
      loadReducedColors: async () => ({ ...DEFAULT_REDUCED_COLORS, enabled: true }),
      saveReducedColors: async () => ({ ok: true as const }),
    };
    renderSlot(app.settingsSections.find((section) => section.id === "chart-colors")!, {}, { rpc: rpc as Rpc });
    await screen.findByRole("radiogroup", { name: "Chart colors" });
    return saved;
  }

  it("is registered on the settings page as Chart Colors", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.settingsSections.find((section) => section.id === "chart-colors")).toMatchObject({ title: "Chart Colors" });
    expect(app.settingsSections.find((section) => section.id === "reduced-colors")).toBeUndefined();
  });

  it("offers the three schemes as one choice, with the stored one selected", async () => {
    await renderSection("model");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.getAttribute("aria-label") ?? radio.labels?.[0]?.textContent)).toEqual([
      expect.stringContaining("Palette"),
      expect.stringContaining("By model"),
      expect.stringContaining("Reduced Colors"),
    ]);
    expect(radios.map((radio) => radio.checked)).toEqual([false, true, false]);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("saves the scheme the owner picks", async () => {
    const saved = await renderSection("palette");
    fireEvent.click(screen.getByRole("radio", { name: /By model/ }));
    await waitFor(() => expect(saved).toEqual(["model"]));
  });

  it("shows the gradient colours only under the Reduced Colors scheme", async () => {
    await renderSection("palette");
    expect(screen.queryByRole("textbox", { name: "Light theme low colour" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Reduced Colors/ }));
    expect(await screen.findByRole("textbox", { name: "Light theme low colour" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Palette/ }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Light theme low colour" })).toBeNull());
  });

  it("shows the gradient colours at once when Reduced Colors is the stored scheme", async () => {
    await renderSection("reduced");
    expect(await screen.findByRole("textbox", { name: "Light theme low colour" })).toBeTruthy();
  });
});

describe("The session page chart under the model colour scheme", () => {
  const TIMELINE = {
    status: "ready" as const,
    totals: { total: 7000, input: 0, cacheWrite: 0, cacheRead: 0, output: 7000, thinking: 0, cost: 0.42, costs: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0.42, thinking: 0 }, messages: 4 },
    agents: [{ key: "main", name: "Main agent", caption: "opus", total: 4500, cost: 0.3 }],
    agent: { key: "main", agentType: null, description: null, model: "opus", spawnDepth: 0, promptExcerpt: null, requestFull: null, requestFullTruncated: false, responseFull: null, responseFullTruncated: false },
    events: [],
    mergeEvents: [],
  };

  it("paints the session's columns by the models of that session's agents", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
    const rpc = { ...rpcWith("model"), agentTimeline: async () => TIMELINE };
    renderSlot<PluginNavPanelProps, typeof rpcContract>(
      registration,
      { subPath: ["agent", "main", "session", "sess_aaa111"].map(encodeURIComponent).join("/") },
      { rpc: rpc as unknown as Rpc },
    );
    await screen.findByLabelText("Session chart");
    await waitFor(() => expect(columnsPainted("#facc15")).toBeGreaterThan(0));
    expect(columnsPainted("#f97316")).toBeGreaterThan(0);
  });
});
