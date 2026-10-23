// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { DEFAULT_VIZ_SETTINGS } from "../src/core";

afterEach(cleanup);

// The page is imported through the app only after loadPluginApp has installed
// the test runtime — see the same note in agent-timeline-page.test.tsx.
const SESSION_SUBPATH = ["agent", "main", "session", "s-root"].map(encodeURIComponent).join("/");

const COSTS = { input: 0.1, cacheWrite: 0.2, cacheRead: 0.3, output: 0.4, thinking: 0.05 };
const totals = (total: number, cost: number) => ({ total, input: 1, cacheWrite: 2, cacheRead: 3, output: 4, thinking: 1, messages: 5, cost, costs: COSTS });

const READY_TIMELINE = {
  status: "ready" as const,
  totals: totals(1000, 0.3),
  agents: [{ key: "main", name: "Main agent", caption: null, total: 1000, cost: 0.3 }],
  agent: {
    key: "main", agentType: null, description: null, model: null, spawnDepth: 0, promptExcerpt: null,
    requestFull: null, requestFullTruncated: false, responseFull: null, responseFullTruncated: false,
  },
  events: [],
  mergeEvents: [],
};

/** A thread's chart entry as the feed's single-session slice returns it. */
function entry(session: string, threadId: string | null, title: string | null, cost: number) {
  return {
    session, project: "p", title: session, start: "2026-10-23T09:00:00.000Z", end: "2026-10-23T09:01:00.000Z", durationSec: 60, activeSec: 60, waitingSec: 0,
    totalTokens: 100, totalCost: cost, workflowCount: 0, bins: [{ t: "2026-10-23T09:00:00.000Z", agents: [{ key: "main", total: 100 }] }],
    cwd: null, gitBranch: null, events: [], bbProjectId: null, bbProjectName: null, threadId, bbThreadTitle: title, isAlive: true, isWorking: false, flowStages: [],
  };
}

const member = (threadId: string, title: string, sessionId: string, cost: number, withChart = true) => ({
  threadId, title, sessionId, totals: totals(100, cost),
  chart: withChart ? { thread: entry(sessionId, threadId, title, cost), agentLabels: { main: "Main agent" } } : null,
});

const family = (over: Record<string, unknown> = {}) => ({
  status: "ready" as const,
  members: [member("t-root", "Parent thread", "s-root", 1), member("t-child", "Child thread", "s-child", 2.5), member("t-hidden", "Hidden agent thread", "s-hidden", 0.25)],
  total: totals(300, 3.75),
  truncated: false,
  unreadable: 0,
  ...over,
});

async function renderSession(threadFamily: PluginRpcTestHandlers<typeof rpcContract>["threadFamily"]) {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.navPanels.find((p) => p.id === "threads-timeline");
  if (!registration) throw new Error("threads-timeline nav panel is not registered");
  const rpc: PluginRpcTestHandlers<typeof rpcContract> = {
    sessionTokenUsage: async () => ({ status: "no-session" as const }),
    agentTimeline: async () => READY_TIMELINE,
    threadsTimeline: async () => ({ status: "ready" as const, unit: 60, threads: [entry("s-root", "t-root", "Parent thread", 1)], agentLabels: { main: "Main agent" }, truncated: false }),
    threadFamily,
    loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
    saveVizSettings: async () => ({ ok: true as const }),
  };
  return renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: SESSION_SUBPATH }, { rpc });
}

describe("session page — thread family", () => {
  it("asks for the family of the thread that owns the session, with the chart's bin width and workflow grouping", async () => {
    const threadFamily = vi.fn(async () => family());
    await renderSession(threadFamily);

    await screen.findByRole("region", { name: "Thread family" });

    expect(threadFamily).toHaveBeenCalledWith({ threadId: "t-root", unit: 60, groupWorkflows: true });
  });

  it("shows the total of the whole family on top: tokens, cost and the breakdown by kind", async () => {
    await renderSession(async () => family());

    const block = await screen.findByRole("region", { name: "Thread family" });

    expect(within(block).getByText("3 threads")).toBeTruthy();
    expect(within(block).getByText("300")).toBeTruthy();
    expect(within(block).getByText("$3.75")).toBeTruthy();
    expect(within(block).getByText("Cache read")).toBeTruthy();
  });

  it("gives every thread of the family its own chart card, the thread itself first", async () => {
    await renderSession(async () => family());

    const block = await screen.findByRole("region", { name: "Thread family" });
    const cards = within(block).getAllByRole("group", { name: /^Thread: / });

    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(["Thread: Parent thread", "Thread: Child thread", "Thread: Hidden agent thread"]);
    expect(within(cards[1]!).getByText("Child thread")).toBeTruthy();
  });

  it("names a thread whose chart could not be built and still counts it in the total", async () => {
    await renderSession(async () =>
      family({ members: [member("t-root", "Parent thread", "s-root", 1), member("t-child", "Child thread", "s-child", 2.5, false)], total: totals(200, 3.5) }),
    );

    const block = await screen.findByRole("region", { name: "Thread family" });

    expect(within(block).getByText("Child thread — chart unavailable · $2.50")).toBeTruthy();
    expect(within(block).getByText("$3.50")).toBeTruthy();
  });

  it("says when the family was cut short or some threads could not be read", async () => {
    await renderSession(async () => family({ truncated: true, unreadable: 2 }));

    const block = await screen.findByRole("region", { name: "Thread family" });

    expect(within(block).getByText(/only the first 3 threads are counted/i)).toBeTruthy();
    expect(within(block).getByText(/2 threads could not be read/i)).toBeTruthy();
  });

  it("hides the charts on request and keeps the total", async () => {
    await renderSession(async () => family());

    const block = await screen.findByRole("region", { name: "Thread family" });
    fireEvent.click(within(block).getByRole("button", { name: "Hide charts" }));

    expect(within(block).queryAllByRole("group", { name: /^Thread: / })).toHaveLength(0);
    expect(within(block).getByText("$3.75")).toBeTruthy();
    fireEvent.click(within(block).getByRole("button", { name: "Show charts" }));
    expect(within(block).getAllByRole("group", { name: /^Thread: / })).toHaveLength(3);
  });

  it("shows nothing extra for a thread that started no other threads", async () => {
    const threadFamily = vi.fn(async () => ({ status: "ready" as const, members: [], total: totals(0, 0), truncated: false, unreadable: 0 }));
    await renderSession(threadFamily);

    await screen.findByLabelText("Session chart");
    await waitFor(() => expect(threadFamily).toHaveBeenCalled());

    expect(screen.queryByRole("region", { name: "Thread family" })).toBeNull();
  });

  it("leaves the page as it was when the family cannot be read", async () => {
    const threadFamily = vi.fn(async () => ({ status: "error" as const, message: "daemon unreachable" }));
    await renderSession(threadFamily);

    await screen.findByLabelText("Session chart");
    await waitFor(() => expect(threadFamily).toHaveBeenCalled());

    expect(screen.queryByRole("region", { name: "Thread family" })).toBeNull();
  });

  it("does not ask for a family while the session belongs to no bb thread", async () => {
    const threadFamily = vi.fn(async () => family());
    const app = await loadPluginApp(() => import("../app"));
    const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
    await renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: SESSION_SUBPATH }, {
      rpc: {
        agentTimeline: async () => READY_TIMELINE,
        threadsTimeline: async () => ({ status: "ready" as const, unit: 60, threads: [entry("s-root", null, null, 1)], agentLabels: {}, truncated: false }),
        threadFamily,
        loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
        saveVizSettings: async () => ({ ok: true as const }),
      },
    });

    await screen.findByLabelText("Session chart");

    expect(threadFamily).not.toHaveBeenCalled();
  });
});

describe("session page — thread family: money on the cards", () => {
  it("shows on every card the cost the total counted for that thread", async () => {
    await renderSession(async () => family());

    const block = await screen.findByRole("region", { name: "Thread family" });
    const cards = within(block).getAllByRole("group", { name: /^Thread: / });

    // A card's one-line summary opens with its cost: "$1.00 · 1 min 0 s · …".
    const costOf = (card: HTMLElement) => /^(\$\d+\.\d\d) · /.exec(within(card).getByText(/^\$\d+\.\d\d · /).textContent ?? "")?.[1];

    expect(cards.map(costOf)).toEqual(["$1.00", "$2.50", "$0.25"]);
  });
});
