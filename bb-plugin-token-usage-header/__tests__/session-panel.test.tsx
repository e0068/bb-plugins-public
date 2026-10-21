// @vitest-environment jsdom
// The session page in three places: the Usage Analytics page, the thread's
// right-panel tab and the header popover — plus the setting that picks what
// a click on the header counter opens.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps, PluginThreadHeaderActionProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { DEFAULT_VIZ_SETTINGS } from "../src/core";

afterEach(cleanup);

const TOTALS = {
  total: 1000,
  input: 200,
  cacheWrite: 100,
  cacheRead: 600,
  output: 90,
  thinking: 10,
  cost: 0.3,
  costs: { input: 0.05, cacheWrite: 0.02, cacheRead: 0.1, output: 0.12, thinking: 0.01 },
  messages: 5,
};
const AGENTS = [
  { key: "main", name: "Main agent", caption: "opus 700", total: 700, cost: 0.2 },
  { key: "agent-a11", name: "code-reviewer", caption: "code-reviewer · opus · high", total: 300, cost: 0.1 },
];

function timeline(agentKey: string) {
  return {
    status: "ready" as const,
    totals: TOTALS,
    agents: AGENTS,
    agent: {
      key: agentKey,
      agentType: null,
      description: null,
      model: "opus",
      spawnDepth: 0,
      parentToolUseId: null,
      requestFull: null,
      requestTruncated: false,
      responseFull: null,
      responseTruncated: false,
    },
    events: [
      {
        ts: "2026-10-12T10:00:00.000Z",
        kind: "message" as const,
        role: "user" as const,
        text: `prompt of ${agentKey}`,
        fullText: `full prompt of ${agentKey}`,
        fullTextTruncated: false,
        tokens: 10,
        cost: 0.001,
      },
    ],
    mergeEvents: [],
  };
}

function sessionChartSlice() {
  return {
    status: "ready" as const,
    unit: 60,
    truncated: false,
    agentLabels: { main: "Main agent" },
    threads: [
      {
        session: "sess_1",
        project: "p",
        title: "sess_1",
        start: "2026-10-12T10:00:00.000Z",
        end: "2026-10-12T10:01:00.000Z",
        durationSec: 60,
        activeSec: 60,
        waitingSec: 0,
        totalTokens: 1000,
        totalCost: 0.3,
        workflowCount: 0,
        bins: [{ t: "2026-10-12T10:00:00.000Z", agents: [{ key: "main", total: 1000 }] }],
        cwd: null,
        gitBranch: null,
        events: [],
        bbProjectId: null,
        bbProjectName: null,
        threadId: null,
        bbThreadTitle: null,
        flowStages: [],
      },
    ],
  };
}

function rpcHandlers(overrides: Record<string, (input: never) => unknown> = {}) {
  return {
    threadSession: async () => ({ sessionId: "sess_1" }),
    sessionTokenUsage: async () => ({ status: "ready" as const, sessionId: "sess_1", totals: TOTALS, agents: AGENTS, truncated: false }),
    agentTimeline: async ({ agent }: { agent: string }) => timeline(agent),
    threadsTimeline: async () => ({ status: "ready" as const, unit: 60, threads: [], agentLabels: {} }),
    loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
    saveVizSettings: async () => ({ ok: true as const }),
    loadReducedColors: async () => ({ enabled: false }),
    ...overrides,
  };
}

async function renderPanelTab(threadId = "thread-1", rpc = rpcHandlers()) {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.threadPanelActions.find((action) => action.id === "session");
  if (!registration) throw new Error("the session thread panel action is not registered");
  return renderSlot<PluginThreadPanelProps>(registration, { threadId, params: null }, { rpc });
}

async function renderHeader(settings: Record<string, string | boolean>, openThreadPanel = vi.fn(() => true), rpc = rpcHandlers()) {
  const app = await loadPluginApp(() => import("../app"));
  const [registration] = app.threadHeaderActions;
  const props: PluginThreadHeaderActionProps = { threadId: "thread-1", isCompactViewport: false };
  return renderSlot<PluginThreadHeaderActionProps>(registration, props, { rpc, settings, openThreadPanel });
}

const agentTimelineCalls = (slot: { rpcCalls: ReadonlyArray<{ method: string; input: unknown }> }) =>
  slot.rpcCalls.filter((call) => call.method === "agentTimeline");

describe("session tab in the thread's right panel", () => {
  it("is offered in the right panel's launcher as \"Token usage\", laid out by the page itself", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.threadPanelActions).toContainEqual(expect.objectContaining({ id: "session", title: "Token usage", layout: "flush" }));
  });

  it("shows the whole session page of the tab's thread: totals, agents and the event timeline", async () => {
    const slot = await renderPanelTab("thread-7");
    expect(await screen.findByText("Total tokens")).toBeTruthy();
    expect(await screen.findByText("prompt of main")).toBeTruthy();
    expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "threadSession", input: { threadId: "thread-7" } }));
    expect(agentTimelineCalls(slot)[0]?.input).toEqual({ session: "sess_1", agent: "main" });
  });

  it("switches the timeline to another agent inside the tab, without leaving the thread", async () => {
    const slot = await renderPanelTab();
    await screen.findByText("prompt of main");
    fireEvent.click(screen.getByRole("button", { name: /code-reviewer/ }));
    expect(await screen.findByText("prompt of agent-a11")).toBeTruthy();
    expect(slot.navigateCalls).toEqual([]);
  });

  it("says the session hasn't started when the thread has none yet", async () => {
    await renderPanelTab("thread-1", rpcHandlers({ threadSession: async () => ({ sessionId: null }) }));
    expect(await screen.findByText(/hasn't started yet/)).toBeTruthy();
  });

  it("shows the chart without a caption above it", async () => {
    const slot = await renderPanelTab("thread-1", rpcHandlers({ threadsTimeline: async () => sessionChartSlice() }));
    await screen.findByLabelText("Session chart");
    expect(slot.container.textContent).not.toContain("Session chart");
  });

  it("lays its columns out by its own width, not the window's", async () => {
    await renderPanelTab();
    const card = (await screen.findByText("Total tokens")).closest(".rounded-lg")!;
    const grid = card.parentElement!;
    expect(grid.className).toContain("@[44rem]:grid-cols-[20rem_1fr]");
    expect(grid.className).not.toMatch(/(^|\s)lg:/);
    expect(grid.closest(".\\@container")).not.toBeNull();
  });
});

describe("header counter click", () => {
  it("opens the popover by default: the session chart and left column only, no timeline", async () => {
    const openThreadPanel = vi.fn(() => true);
    const slot = await renderHeader({}, openThreadPanel);
    fireEvent.click(await screen.findByRole("button", { name: /Token usage: 1/ }));
    expect(await screen.findByText("Total tokens")).toBeTruthy();
    expect(screen.getByRole("button", { name: /code-reviewer/ })).toBeTruthy();
    expect(screen.queryByText("Session timeline")).toBeNull();
    expect(openThreadPanel).not.toHaveBeenCalled();
    expect(agentTimelineCalls(slot)).toEqual([]);
  });

  it("with the cost metric labels the popover chart's segments in dollars", async () => {
    const slice = sessionChartSlice();
    const priced = {
      ...slice,
      threads: [{ ...slice.threads[0], bins: [{ t: "2026-10-12T10:00:00.000Z", agents: [{ key: "main", total: 1000, cost: 0.3 }] }] }],
    };
    await renderHeader({ chartMetric: "cost" }, vi.fn(() => true), rpcHandlers({ threadsTimeline: async () => priced }));
    fireEvent.click(await screen.findByRole("button", { name: /Token usage: 1/ }));
    expect(await screen.findByLabelText("Main agent: $0.30")).toBeTruthy();
  });

  it("with \"panel\" chosen opens the Token usage tab instead of the popover", async () => {
    const openThreadPanel = vi.fn(() => true);
    await renderHeader({ headerClick: "panel" }, openThreadPanel);
    fireEvent.click(await screen.findByRole("button", { name: /Token usage: 1/ }));
    expect(openThreadPanel).toHaveBeenCalledWith({ actionId: "session" });
    expect(screen.queryByText("Total tokens")).toBeNull();
  });

  it("with \"panel\" chosen reloads an already open tab of the same thread, and only that one", async () => {
    const own = await renderPanelTab("thread-1");
    const other = await renderPanelTab("thread-2");
    await waitFor(() => expect(screen.getAllByText("prompt of main")).toHaveLength(2));
    expect(agentTimelineCalls(own)).toHaveLength(1);
    expect(agentTimelineCalls(other)).toHaveLength(1);

    await renderHeader({ headerClick: "panel" });
    fireEvent.click(await screen.findByRole("button", { name: /Token usage: 1/ }));

    await waitFor(() => expect(agentTimelineCalls(own)).toHaveLength(2));
    expect(agentTimelineCalls(other)).toHaveLength(1);
    expect(screen.getAllByText("prompt of main")).toHaveLength(2);
  });
});

describe("Usage Analytics session page", () => {
  it("keeps its back link and lays its columns out by its own width", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const registration = app.navPanels.find((panel) => panel.id === "threads-timeline")!;
    renderSlot<PluginNavPanelProps>(registration, { subPath: "agent/main/session/sess_1" }, { rpc: rpcHandlers() });
    expect(await screen.findByRole("button", { name: /Usage Analytics/ })).toBeTruthy();
    const grid = (await screen.findByText("Total tokens")).closest(".rounded-lg")!.parentElement!;
    expect(grid.className).toContain("@[44rem]:grid-cols-[20rem_1fr]");
  });
});

describe("reloading the open tab", () => {
  async function clickCounterInPanelMode(openThreadPanel = vi.fn(() => true)) {
    const header = await renderHeader({ headerClick: "panel" }, openThreadPanel);
    fireEvent.click(await screen.findByRole("button", { name: /Token usage: 1/ }));
    return header;
  }

  it("keeps an expanded event expanded", async () => {
    const tab = await renderPanelTab();
    fireEvent.click(await screen.findByText("prompt of main"));
    await screen.findByText("full prompt of main");

    await clickCounterInPanelMode();

    await waitFor(() => expect(agentTimelineCalls(tab)).toHaveLength(2));
    expect(screen.getByText("full prompt of main")).toBeTruthy();
  });

  it("asks the server past its cache, and only for the reload itself", async () => {
    const tab = await renderPanelTab();
    await screen.findByText("prompt of main");

    await clickCounterInPanelMode();
    await waitFor(() => expect(agentTimelineCalls(tab)).toHaveLength(2));
    expect(agentTimelineCalls(tab)[1].input).toEqual({ session: "sess_1", agent: "main", fresh: true });
    await waitFor(() =>
      expect(tab.rpcCalls.filter((call) => call.method === "threadsTimeline").at(-1)?.input).toMatchObject({ fresh: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: /code-reviewer/ }));
    await waitFor(() => expect(agentTimelineCalls(tab)).toHaveLength(3));
    expect(agentTimelineCalls(tab)[2].input).toEqual({ session: "sess_1", agent: "agent-a11" });
  });

  it("picks up the thread's new session and opens its main agent", async () => {
    const sessions = ["sess_1", "sess_2"];
    const tab = await renderPanelTab("thread-1", rpcHandlers({ threadSession: async () => ({ sessionId: sessions.shift() ?? "sess_2" }) }));
    await screen.findByText("prompt of main");
    fireEvent.click(screen.getByRole("button", { name: /code-reviewer/ }));
    await screen.findByText("prompt of agent-a11");

    await clickCounterInPanelMode();

    await waitFor(() => expect(agentTimelineCalls(tab).at(-1)?.input).toEqual({ session: "sess_2", agent: "main" }));
  });
});

describe("header counter click without a right panel", () => {
  it("opens the session page in Usage Analytics when bb can't open the tab", async () => {
    const header = await renderHeader({ headerClick: "panel" }, vi.fn(() => false));
    fireEvent.click(await screen.findByRole("button", { name: /Token usage: 1/ }));
    expect(header.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: { subPath: "agent/main/session/sess_1" },
    });
  });
});

describe("popover breakdown card", () => {
  it("says the agent list is cut when the server capped it", async () => {
    await renderHeader(
      {},
      vi.fn(() => true),
      rpcHandlers({
        sessionTokenUsage: async () => ({ status: "ready" as const, sessionId: "sess_1", totals: TOTALS, agents: AGENTS, truncated: true }),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Token usage: 1/ }));
    expect(await screen.findByText("not all shown")).toBeTruthy();
  });
});
