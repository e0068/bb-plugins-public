// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../server";
// Pure schema/defaults module (zod-only, no bb SDK) — safe to import
// statically even though this file otherwise avoids static imports from the
// plugin's own modules (see the comment below on buildAgentDetailSubPath).
import { DEFAULT_VIZ_SETTINGS, type VizSettings } from "../src/core";

afterEach(cleanup);

// Same reasoning as agent-timeline-page.test.tsx: not imported from
// ../pages/AgentTimelinePage, to avoid evaluating "@get-bb/plugin-sdk/app"
// before loadPluginApp installs the test runtime.
interface AgentDetailLinkParams {
  agent: string;
  session: string;
  from?: string;
  to?: string;
}
function buildAgentDetailSubPath(params: AgentDetailLinkParams): string {
  // Path segments, mirroring the page: BB percent-encodes subPath, so a query
  // string would lose `session`; ordered key/value segments survive.
  const seg: string[] = ["agent", params.agent, "session", params.session];
  if (params.from) seg.push("from", params.from);
  if (params.to) seg.push("to", params.to);
  return seg.map(encodeURIComponent).join("/");
}

function assertMatchesContract(method: keyof typeof rpcContract, input: unknown) {
  const result = rpcContract[method].input["~standard"].validate(input);
  if (result instanceof Promise) {
    throw new Error(`method "${method}"'s schema is async — this test doesn't await it`);
  }
  if (result.issues !== undefined) {
    throw new Error(
      `method "${method}"'s input fails the contract: ${JSON.stringify(input)}\n` +
        result.issues.map((issue) => `  · ${issue.message}`).join("\n"),
    );
  }
}

function unusedRpcMethod(name: string) {
  return async () => {
    throw new Error(`unexpected call to unstubbed rpc method "${name}" in a threads-timeline-page test`);
  };
}

// The script's own `title` field always equals `session` in real data (see
// threads-timeline.ts's RawThreadEntrySchema doc comment) — kept that way
// here too, so these fixtures don't rely on a field the card no longer
// displays. The card's header now shows `bbThreadTitle` (BB's human thread
// name) instead, falling back to a short session id when there's no BB
// thread match — see the dedicated tests below for that fallback.
const THREAD_B_SESSION = "sess_bbb222";
const THREAD_B_FALLBACK_TITLE = THREAD_B_SESSION.slice(0, 8);

const THREADS_READY = {
  status: "ready" as const,
  unit: 60,
  threads: [
    {
      session: "sess_aaa111",
      // Raw transcript-directory slug — no longer shown by the project
      // picker (see ThreadsTimelinePage.tsx's projectOptions doc comment);
      // only bbProjectName/threadId below drive it now.
      project: "token-usage-header",
      title: "sess_aaa111",
      start: "2026-08-25T09:00:00.000Z",
      end: "2026-08-25T09:05:00.000Z",
      durationSec: 300,
      totalTokens: 5000,
      totalCost: 0.42,
      workflowCount: 2,
      bins: [
        { t: "2026-08-25T09:00:00.000Z", agents: [{ key: "main", total: 3000 }] },
        { t: "2026-08-25T09:01:00.000Z", agents: [{ key: "main", total: 1500 }, { key: "code-reviewer", total: 500 }] },
      ],
      cwd: null,
      gitBranch: null,
      events: [],
      bbProjectId: "bb-proj-1",
      bbProjectName: "Token Usage Header",
      threadId: "thread-aaa",
      bbThreadTitle: "Thread A",
    },
    {
      session: THREAD_B_SESSION,
      project: "workflow-composer",
      title: THREAD_B_SESSION,
      start: "2026-08-25T08:00:00.000Z",
      end: "2026-08-25T08:02:00.000Z",
      durationSec: 120,
      totalTokens: 1000,
      totalCost: 0.05,
      workflowCount: 0,
      bins: [{ t: "2026-08-25T08:00:00.000Z", agents: [{ key: "main", total: 1000 }] }],
      cwd: null,
      gitBranch: null,
      events: [],
      // No matching BB thread — the "Threads" bucket on the project picker,
      // and the card falls back to the short session id for its title.
      bbProjectId: null,
      bbProjectName: null,
      threadId: null,
      bbThreadTitle: null,
    },
  ],
  // "main" gets a real label; "code-reviewer" is left unmapped on purpose —
  // exercises the labelFor fallback (agentLabels[key] ?? key) alongside the
  // mapped case, in the same fixture used by most tests below.
  agentLabels: { main: "Main agent" },
};

// Fixture for the collapseEmpty ("Collapse gaps") feature tests below —
// two consecutive empty bins sandwiched between real activity, isolated from
// THREADS_READY so those existing tests' bin counts/tooltips stay untouched.
const COLLAPSE_SESSION = "sess_collapse1";
const THREADS_WITH_GAPS = {
  status: "ready" as const,
  unit: 60,
  threads: [
    {
      session: COLLAPSE_SESSION,
      project: "token-usage-header",
      title: COLLAPSE_SESSION,
      start: "2026-08-25T09:00:00.000Z",
      end: "2026-08-25T09:04:00.000Z",
      durationSec: 240,
      totalTokens: 2000,
      totalCost: 0.2,
      workflowCount: 1,
      bins: [
        { t: "2026-08-25T09:00:00.000Z", agents: [{ key: "main", total: 1000 }] },
        { t: "2026-08-25T09:01:00.000Z", agents: [] },
        { t: "2026-08-25T09:02:00.000Z", agents: [] },
        { t: "2026-08-25T09:03:00.000Z", agents: [{ key: "main", total: 1000 }] },
      ],
      cwd: null,
      gitBranch: null,
      events: [],
      bbProjectId: "bb-proj-1",
      bbProjectName: "Token Usage Header",
      threadId: "thread-collapse",
      bbThreadTitle: "Thread with a pause",
    },
  ],
  agentLabels: { main: "Main agent" },
};

async function renderThreadsTimeline(
  rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>>,
  settings?: Record<string, string | boolean>,
) {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.navPanels.find((p) => p.id === "threads-timeline");
  if (!registration) throw new Error("threads-timeline nav panel is not registered");
  const props: PluginNavPanelProps = { subPath: "" };
  const fullRpc: PluginRpcTestHandlers<typeof rpcContract> = {
    sessionTokenUsage: unusedRpcMethod("sessionTokenUsage"),
    agentTimeline: unusedRpcMethod("agentTimeline"),
    threadsTimeline: unusedRpcMethod("threadsTimeline"),
    loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
    saveVizSettings: async () => ({ ok: true as const }),
    ...rpc,
  };
  return renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, props, { rpc: fullRpc, settings });
}

// Everything except project filter / sort / search / agent colours now lives
// on the plugin's native Settings page (Tools → Usage Analytics, via
// bb.settings.define — see src/core/gear-settings.ts) and is exercised here
// through renderThreadsTimeline's `settings` option, not by clicking an
// in-page control. Only the per-agent colour picker remains an in-page
// popover — open it before asserting or driving that.
async function openAgentColors() {
  fireEvent.click(screen.getByRole("button", { name: "Agent colors" }));
  await screen.findByText("Agent colors");
}

describe("threads-timeline nav panel", () => {
  it("registers a single nav panel (no separate agent-detail panel)", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.navPanels.map((p) => p.id)).toEqual(["threads-timeline"]);
    const panel = app.navPanels.find((p) => p.id === "threads-timeline")!;
    expect(panel.path).toBe("threads");
  });

  it("fetches the initial slice with the default unit/limit, matching the rpc contract, and renders one row per thread", async () => {
    const slot = await renderThreadsTimeline({
      threadsTimeline: async (input) => {
        expect(input).toEqual({ limit: 20, unit: 60 });
        return THREADS_READY;
      },
    });

    await screen.findByText("Thread A");
    await screen.findByText(THREAD_B_FALLBACK_TITLE);

    for (const call of slot.rpcCalls) {
      assertMatchesContract(call.method as keyof typeof rpcContract, call.input);
    }
  });

  it("fetches with the bucket width from the plugin's Settings page (bb.settings.define), not a hardcoded unit", async () => {
    let lastInput: unknown;
    await renderThreadsTimeline(
      {
        threadsTimeline: async (input) => {
          lastInput = input;
          return { ...THREADS_READY, unit: (input as { unit: number }).unit };
        },
      },
      { unit: "300" },
    );

    await screen.findByText("Thread A");
    expect(lastInput).toEqual({ limit: 20, unit: 300 });
  });

  it("builds the project picker from bbProjectName (real BB projects) plus a \"Threads\" bucket for bbProjectName===null, not the raw directory slug", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    // The real BB project name shows up as a chip…
    screen.getByRole("button", { name: "Token Usage Header" });
    // …and sessions with no BB thread match collapse into one "Threads" chip…
    screen.getByRole("button", { name: "Threads" });
    // …but never the raw transcript-directory slugs themselves.
    expect(screen.queryByRole("button", { name: "token-usage-header" })).toBeNull();
    expect(screen.queryByRole("button", { name: "workflow-composer" })).toBeNull();
  });

  it("filters rows client-side by project chip (real BB project) without a new rpc call", async () => {
    const slot = await renderThreadsTimeline({
      threadsTimeline: async () => THREADS_READY,
    });
    await screen.findByText("Thread A");
    const callsBefore = slot.rpcCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Token Usage Header" }));

    await screen.findByText("Thread A");
    expect(screen.queryByText(THREAD_B_FALLBACK_TITLE)).toBeNull();
    expect(slot.rpcCalls.length).toBe(callsBefore);
  });

  it("filters rows client-side by the \"Threads\" bucket chip (bbProjectName === null)", async () => {
    const slot = await renderThreadsTimeline({
      threadsTimeline: async () => THREADS_READY,
    });
    await screen.findByText("Thread A");
    const callsBefore = slot.rpcCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Threads" }));

    await screen.findByText(THREAD_B_FALLBACK_TITLE);
    expect(screen.queryByText("Thread A")).toBeNull();
    expect(slot.rpcCalls.length).toBe(callsBefore);
  });

  it("filters rows client-side by search text", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    fireEvent.change(screen.getByPlaceholderText("By name or session ID"), { target: { value: "bbb222" } });

    await screen.findByText(THREAD_B_FALLBACK_TITLE);
    expect(screen.queryByText("Thread A")).toBeNull();
  });

  it("clicking a bar segment navigates to the threads panel's agent-detail sub-view with agent/session/from/to, no threadId", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    const segment = screen.getByLabelText(/code-reviewer: 500 tokens/);
    fireEvent.click(segment);

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: {
        subPath: buildAgentDetailSubPath({
          agent: "code-reviewer",
          session: "sess_aaa111",
          from: "2026-08-25T09:01:00.000Z",
          to: "2026-08-25T09:02:00.000Z",
        }),
      },
    });
  });

  it("shows the human agentLabels name in the agent-colours popover, not the raw agent key", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");
    await openAgentColors();

    // "main" -> agentLabels["main"] = "Main agent" — the raw key never
    // appears as the agent-colour row's text.
    screen.getByText("Main agent");
    expect(screen.queryByText("main", { selector: "span.truncate" })).toBeNull();
  });

  it("falls back to the raw agent key in the agent-colours popover when agentLabels has no entry for it", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");
    await openAgentColors();

    // "code-reviewer" has no entry in THREADS_READY.agentLabels.
    screen.getByText("code-reviewer");
  });

  it("labels each agent-colour picker with the mapped name, not the raw key", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");
    await openAgentColors();

    // "main" is mapped to "Main agent"; its colour input is addressed by
    // that human label, never the raw key.
    const input = screen.getByLabelText("Main agent color") as HTMLInputElement;
    expect(input.type).toBe("color");
  });

  it("shows the mapped label (not the raw agent key) in a bar segment's accessible name", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    // Thread A's first bin has a "main" segment (3000 tokens) — "main" is
    // mapped to "Main agent" in agentLabels, so the segment's aria-label
    // must show that label, not the raw "main" key.
    screen.getByLabelText(/Main agent: 3\.0k tokens/);
  });

  it("shows the column's time range and a per-agent legend (tokens + %) in an immediate hover tooltip", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Thread A");

    // Thread A's second bin: main 1500 + code-reviewer 500 = 2000 → 75% / 25%.
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    fireEvent.mouseMove(columns[1] as HTMLElement, { clientX: 10, clientY: 10 });

    // Time range of that column (clock is runner-TZ-dependent — assert only
    // the HH:MM–HH:MM shape), and both agents with their token/share split.
    await screen.findByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
    screen.getByText(/1\.5k · 75%/);
    screen.getByText(/500 · 25%/);
  });

  it("marks a column with a git event icon and shows its label + link in the hover tooltip", async () => {
    const withCommit = {
      status: "ready" as const,
      unit: 60,
      threads: [
        {
          ...THREADS_READY.threads[0],
          events: [
            {
              type: "commit" as const,
              ts: "2026-08-25T09:01:10.000Z", // inside the thread's second (09:01) bin
              hash: "a5ee9a4b3c2d1e0f",
              message: "fix bug",
              url: "https://github.com/e0068/bb-plugins/commit/a5ee9a4b3c2d1e0f",
            },
          ],
        },
      ],
      agentLabels: THREADS_READY.agentLabels,
    };
    await renderThreadsTimeline({ threadsTimeline: async () => withCommit });
    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;

    const marker = card.querySelector('[data-icon="GitCommit"]');
    expect(marker).not.toBeNull();

    fireEvent.mouseMove(marker!.parentElement as HTMLElement, { clientX: 10, clientY: 10 });

    const link = (await screen.findByText("a5ee9a4 fix bug")) as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://github.com/e0068/bb-plugins/commit/a5ee9a4b3c2d1e0f");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("clamps the hover tooltip inside the viewport instead of letting it overflow past a screen edge", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    // A small window and a tooltip whose real size (mocked — jsdom never lays
    // out text) would overflow it from the bottom-right, same as a column
    // near the right edge of a narrow panel.
    window.innerWidth = 400;
    window.innerHeight = 300;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 220,
      height: 100,
      top: 0,
      left: 0,
      right: 220,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
      const title = await screen.findByText("Thread A");
      const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
      const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
      // Natural anchor (clientX/Y + 12) plus the mocked 220×100 tooltip would
      // land at right 612 / bottom 392 — both past the 400×300 window.
      fireEvent.mouseMove(columns[1] as HTMLElement, { clientX: 380, clientY: 280 });

      const tooltip = (await screen.findByText(/1\.5k · 75%/)).closest("div") as HTMLElement;
      await waitFor(() => {
        const left = parseFloat(tooltip.style.left);
        const top = parseFloat(tooltip.style.top);
        expect(left + 220).toBeLessThanOrEqual(400 - 8);
        expect(top + 100).toBeLessThanOrEqual(300 - 8);
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      window.innerWidth = originalInnerWidth;
      window.innerHeight = originalInnerHeight;
    }
  });

  it("keeps the colour/click identity on the raw agent key even though the legend/tooltip show the mapped label", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    // Clicking the "main" segment must still navigate with agent="main" (the
    // raw key), never the display label "Main agent".
    const segment = screen.getByLabelText(/Main agent: 3\.0k tokens/);
    fireEvent.click(segment);

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: {
        subPath: buildAgentDetailSubPath({
          agent: "main",
          session: "sess_aaa111",
          from: "2026-08-25T09:00:00.000Z",
          to: "2026-08-25T09:01:00.000Z",
        }),
      },
    });
  });

  it("shows the server's error status without crashing", async () => {
    await renderThreadsTimeline({
      threadsTimeline: async () => ({ status: "error" as const, message: "boom" }),
    });
    await screen.findByText("boom");
  });

  it("applies segRadius and frameLiftColor from the plugin's Settings page to the chart", async () => {
    await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_READY },
      { segRadius: "6", frameLiftColor: "#112233" },
    );
    await screen.findByText("Thread A");

    const segment = screen.getByLabelText(/code-reviewer: 500 tokens/) as HTMLElement;
    expect(segment.style.borderRadius).toBe("6px");

    const row = segment.closest(".rounded-md.border.border-border") as HTMLElement | null;
    expect(row?.style.backgroundColor).toBe("rgba(17, 34, 51, 0.05)");
  });

  it("saves the full viz settings (including the loaded agentDetail section, untouched) when an agent colour changes", async () => {
    const loadedSettings: VizSettings = {
      threads: DEFAULT_VIZ_SETTINGS.threads,
      agentDetail: { showHooks: false, relativeTime: true, groupedByTurn: true },
    };
    let savedInput: unknown;
    await renderThreadsTimeline({
      threadsTimeline: async () => THREADS_READY,
      loadVizSettings: async () => loadedSettings,
      saveVizSettings: async (input) => {
        savedInput = input;
        return { ok: true as const };
      },
    });
    await screen.findByText("Thread A");

    await openAgentColors();
    fireEvent.change(screen.getByLabelText("Main agent color"), { target: { value: "#123456" } });

    await waitFor(() => expect(savedInput).toBeDefined());
    expect((savedInput as VizSettings).agentDetail).toEqual(loadedSettings.agentDetail);
    expect((savedInput as VizSettings).threads.agentColors.main).toBe("#123456");
    assertMatchesContract("saveVizSettings", savedInput);
  });

  it("shows the BB thread's human title as the card header, not the raw session id duplicated", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });

    await screen.findByText("Thread A");
    // The session id no longer appears anywhere in the card header — only
    // the human title (the old behaviour duplicated the session UUID twice).
    expect(screen.queryByText("sess_aaa111")).toBeNull();
  });

  it("falls back to the short session id (first 8 chars) when bbThreadTitle is null (no matching BB thread)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });

    await screen.findByText(THREAD_B_FALLBACK_TITLE);
    // Never the full raw session id either — the fallback is short, not a
    // second copy of the UUID.
    expect(screen.queryByText(THREAD_B_SESSION)).toBeNull();
  });

  it("renders every card at a constant full container width, regardless of thread duration/bin count (no more proportional widthFractions sizing)", async () => {
    // hugWidth off — this test is about the non-hug width behaviour, independent of the fillWidth toggle exercised elsewhere.
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY }, { hugWidth: false });
    // Thread A: 300s, 2 bins. Thread B (fallback title): 120s, 1 bin — the old
    // widthFractions-driven card width would have made this one much
    // narrower; now both cards must be identically full-width.
    const titleA = await screen.findByText("Thread A");
    const titleB = await screen.findByText(THREAD_B_FALLBACK_TITLE);

    for (const title of [titleA, titleB]) {
      const card = title.closest(".rounded-md.border.border-border") as HTMLElement | null;
      expect(card).not.toBeNull();
      expect(card!.classList.contains("w-full")).toBe(true);
      // No inline width — the card never carries a duration/bin-derived px
      // width (that clamp lived on the card before; it's gone).
      expect(card!.style.width).toBe("");
    }
  });

  it("keeps the card at a constant full width even when a large fixed colWidthPx (fillWidth off) would blow the graph itself far past the container", async () => {
    await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_READY },
      // "999" clamps to colWidthPx's 40px maximum (parseGearSettings) — a
      // native Settings text field has no in-app range guardrail beyond that.
      // hugWidth off — this test is about the non-hug width behaviour.
      { fillWidthFeed: false, hugWidth: false, colWidthPx: "999" },
    );

    // Thread A has 2 bins, so even 2*40 + 1*colGap comfortably exceeds the
    // jsdom fallback container width — this now overflows only the graph's
    // own scroll wrapper inside the card, never the card itself.
    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.classList.contains("w-full")).toBe(true);
    expect(card!.style.width).toBe("");
  });

  it("wraps the graph in its own overflow-x-auto scroll container inside the card, sized to bins*colWidthPx+gaps when fillWidth is off", async () => {
    await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_READY },
      { fillWidthFeed: false, colWidthPx: "35" },
    );

    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const scrollWrapper = card.querySelector(".overflow-x-auto") as HTMLElement | null;
    expect(scrollWrapper).not.toBeNull();
    const graph = scrollWrapper!.querySelector(".flex.items-end") as HTMLElement;
    // Thread A: 2 bins * 35px + 1 gap * default colGap (1px) = 71px — far
    // past the card, so this width can only ever fit via the wrapper's own
    // horizontal scroll, not by stretching the card.
    expect(graph.style.width).toBe("71px");
  });

  it("sizes the graph to 100% of the card (no overflow wrapper needed) when fillWidth is on", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY }, { fillWidthFeed: true });
    const title = await screen.findByText("Thread A");

    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const graph = card.querySelector(".flex.items-end") as HTMLElement;
    expect(graph.style.width).toBe("100%");
  });

  it("sizes each bin column to a fixed colWidthPx (not a shared fraction) when fillWidth is off", async () => {
    await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_READY },
      { fillWidthFeed: false, colWidthPx: "12" },
    );

    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    // Thread A has 2 bins — each fixed-width column reports its own inline
    // width, independent of the other columns or the card's own width.
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    expect(columns.length).toBe(2);
    columns.forEach((col) => {
      expect((col as HTMLElement).style.width).toBe("12px");
      expect((col as HTMLElement).style.flexShrink).toBe("0");
    });
  });

  it("gives every bin column a uniform fixed width (calc of 100%/maxBinCount, not flex-1) when fillWidth is on", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY }, { fillWidthFeed: true });
    const title = await screen.findByText("Thread A");

    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    expect(columns.length).toBe(2);
    columns.forEach((col) => {
      // Uniform width across threads = the longest thread's column width, so
      // only the longest fills the row; no per-card flex-1 stretching.
      expect((col as HTMLElement).classList.contains("flex-1")).toBe(false);
      expect((col as HTMLElement).style.width.startsWith("calc(")).toBe(true);
    });
  });

  it("sizes a hug card to its own graph width (not w-full) and lays the feed out as a wrapping tile grid", async () => {
    await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_READY },
      { fillWidthFeed: false, hugWidth: true },
    );
    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;

    // Card is explicitly sized (not stretched to the row) and capped so a wide
    // graph can't overflow — its inner scroller handles that instead.
    expect(card.classList.contains("w-full")).toBe(false);
    expect(card.style.width).not.toBe("");
    expect(card.style.maxWidth).toBe("100%");

    // The feed itself wraps cards into a tile grid rather than a vertical stack.
    const feed = card.closest("section")?.querySelector(".flex.flex-wrap") as HTMLElement;
    expect(feed).not.toBeNull();
    expect(feed.contains(card)).toBe(true);
  });

  it("caps the content area at contentMaxWidthPx by default and drops the cap when contentFullWidth is on", async () => {
    // Capped case: contentFullWidth off.
    const first = await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_READY },
      { contentFullWidth: false },
    );
    const capped = (await screen.findByText("Thread A")).closest(".mx-auto") as HTMLElement;
    expect(capped.style.maxWidth).toBe("1400px");
    cleanup();
    void first;

    // Full-width: no cap.
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY }, { contentFullWidth: true });
    const full = (await screen.findByText("Thread A")).closest(".mx-auto") as HTMLElement;
    expect(full.style.maxWidth).toBe("none");
  });

  it("scales each card to its own tallest column in perCard height mode (a small thread fills its card, unlike shared mode)", async () => {
    // Shared: Thread B's lone 1000-token bin is 1/3 of the global max
    // (Thread A's 3000) → 24px of the 72px chart.
    const first = await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_READY },
      { heightMode: "shared" },
    );
    const sharedCard = (await screen.findByText(THREAD_B_FALLBACK_TITLE)).closest(".rounded-md.border.border-border") as HTMLElement;
    const sharedStack = sharedCard.querySelector(".absolute.bottom-0.flex-col-reverse") as HTMLElement;
    expect(sharedStack.style.height).toBe("24px");
    cleanup();
    void first;

    // perCard: the same bin is this card's own max → fills the full 72px.
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY }, { heightMode: "perCard" });
    const perCard = (await screen.findByText(THREAD_B_FALLBACK_TITLE)).closest(".rounded-md.border.border-border") as HTMLElement;
    const perCardStack = perCard.querySelector(".absolute.bottom-0.flex-col-reverse") as HTMLElement;
    expect(perCardStack.style.height).toBe("72px");
  });

  it("keeps one column per bin, each empty bin with its own single-unit gap tooltip, when Collapse gaps is off", async () => {
    await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_WITH_GAPS },
      { collapseEmpty: false },
    );
    const title = await screen.findByText("Thread with a pause");

    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    expect(columns.length).toBe(4);
    // Two separate empty bins — each its own column, each its own
    // single-unit gap tooltip (not summed into one).
    expect(screen.getAllByTitle(/1 min 0 s break/)).toHaveLength(2);
  });

  it("collapses consecutive empty bins into one gap column carrying the summed break duration when collapseEmpty is on", async () => {
    await renderThreadsTimeline(
      { threadsTimeline: async () => THREADS_WITH_GAPS },
      { collapseEmpty: true },
    );
    await screen.findByText("Thread with a pause");

    const card = screen.getByText("Thread with a pause").closest(".rounded-md.border.border-border") as HTMLElement;
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    expect(columns.length).toBe(3);
    screen.getByTitle(/2 min 0 s break/);
  });

  it("keeps the feed a plain vertical list — no feed-level horizontal scroll container", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    expect(slot.container.querySelector("section.overflow-x-auto")).toBeNull();
  });

  it("shows the thread's cost ($) in the card header and no longer the word «tokens» there", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Thread A");

    // Thread A's totalCost is 0.42 → "$0.42"; the card header no longer labels
    // the raw token count with the word «tokens» (the page subtitle still may).
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    expect(card.textContent).toContain("$0.42");
    expect(card.textContent).not.toContain("tokens");
  });

  it("shows how many workflows and agents took part, to the left of the duration", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    // Thread A: workflowCount 2; two distinct agent keys across its bins (main +
    // code-reviewer) → "2 agents".
    screen.getByText(/2 workflows · 2 agents/);
  });

  it("opens the matched BB thread when its card title is clicked", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    fireEvent.click(screen.getByRole("button", { name: "Thread A" }));

    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thread-aaa" });
  });

  it("navigates to the session's internal page (main agent, no window) when the card body is clicked", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;

    fireEvent.click(card);

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: { subPath: buildAgentDetailSubPath({ agent: "main", session: "sess_aaa111" }) },
    });
  });

  it("does not also open the card's session page when a segment is clicked (click stops propagating)", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    fireEvent.click(screen.getByLabelText(/code-reviewer: 500 tokens/));

    // The segment's own agent-detail nav fired, but not the card-level
    // main-agent nav (which carries no from/to window).
    expect(slot.navigateCalls).not.toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: { subPath: buildAgentDetailSubPath({ agent: "main", session: "sess_aaa111" }) },
    });
  });

  it("omits workflows entirely (not «0 workflows») for a thread with no workflow runs", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText(THREAD_B_FALLBACK_TITLE);
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;

    // Thread B: workflowCount 0, one agent (main) → "1 agents", never "workflows".
    expect(card.textContent).not.toContain("workflows");
    expect(card.textContent).toContain("1 agents");
  });

  it("highlights the hovered column while its tooltip is shown", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const column = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]")[1] as HTMLElement;

    fireEvent.mouseMove(column, { clientX: 10, clientY: 10 });

    expect(column.className).toContain("bg-state-hover");
  });

  it("leaves the title non-clickable for a session with no BB thread match (the «Threads» bucket)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText(THREAD_B_FALLBACK_TITLE);

    // Thread B has threadId === null — its title is plain text, not a button.
    expect(screen.queryByRole("button", { name: THREAD_B_FALLBACK_TITLE })).toBeNull();
  });

  it("filters threads by a minimum cost bound (from)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    // Thread A $0.42, Thread B $0.05 — a 0.1 floor drops B, keeps A.
    fireEvent.change(screen.getByLabelText("Cost from, USD"), { target: { value: "0.1" } });

    await waitFor(() => expect(screen.queryByText(THREAD_B_FALLBACK_TITLE)).toBeNull());
    screen.getByText("Thread A");
  });

  it("filters threads by a maximum cost bound (to)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Thread A");

    // A 0.1 ceiling drops Thread A ($0.42), keeps Thread B ($0.05).
    fireEvent.change(screen.getByLabelText("Cost to, USD"), { target: { value: "0.1" } });

    await waitFor(() => expect(screen.queryByText("Thread A")).toBeNull());
    screen.getByText(THREAD_B_FALLBACK_TITLE);
  });

  it("hydrates the filter state (search) from loadVizSettings and applies it", async () => {
    const loaded: VizSettings = {
      threads: { ...DEFAULT_VIZ_SETTINGS.threads, searchQuery: "bbb222" },
      agentDetail: DEFAULT_VIZ_SETTINGS.agentDetail,
    };
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY, loadVizSettings: async () => loaded });

    // The persisted search term is in the box and already filters the feed.
    await screen.findByText(THREAD_B_FALLBACK_TITLE);
    expect((screen.getByPlaceholderText("By name or session ID") as HTMLInputElement).value).toBe("bbb222");
    expect(screen.queryByText("Thread A")).toBeNull();
  });

  it("persists a filter change (cost bound) into the saved viz settings", async () => {
    let saved: unknown;
    await renderThreadsTimeline({
      threadsTimeline: async () => THREADS_READY,
      saveVizSettings: async (input) => {
        saved = input;
        return { ok: true as const };
      },
    });
    await screen.findByText("Thread A");

    fireEvent.change(screen.getByLabelText("Cost from, USD"), { target: { value: "0.1" } });

    await waitFor(() => expect((saved as VizSettings | undefined)?.threads.costMin).toBe("0.1"));
    assertMatchesContract("saveVizSettings", saved);
  });

  it("fades the column tooltip out over ~200ms after the pointer leaves, then unmounts it", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Thread A");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const column = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]")[1] as HTMLElement;

    fireEvent.mouseMove(column, { clientX: 10, clientY: 10 });
    const tooltip = (await screen.findByText(/1\.5k · 75%/)).closest("div") as HTMLElement;

    // Leaving starts the fade — the node stays mounted but its opacity animates
    // to 0 (ease-in) rather than vanishing on a fully-visible hold…
    fireEvent.mouseOut(column);
    expect(tooltip.className).toContain("opacity-0");
    expect(tooltip.className).toContain("ease-in");
    screen.getByText(/1\.5k · 75%/);

    // …and only after the fade does it unmount.
    await waitForElementToBeRemoved(() => screen.queryByText(/1\.5k · 75%/));
  });
});

describe("threads-timeline nav panel — liveness indicators", () => {
  // Three cards: a live thread with work running, a live-but-idle thread, and
  // an archived (dead) thread — one fixture covering every indicator branch.
  const LIVENESS_READY = {
    status: "ready" as const,
    unit: 60,
    threads: [
      {
        session: "sess_live1",
        project: "p",
        title: "sess_live1",
        start: "2026-08-25T09:00:00.000Z",
        end: "2026-08-25T09:05:00.000Z",
        durationSec: 300,
        totalTokens: 5000,
        totalCost: 0.42,
        workflowCount: 0,
        bins: [{ t: "2026-08-25T09:00:00.000Z", agents: [{ key: "main", total: 3000 }] }],
        cwd: null,
        gitBranch: null,
        events: [],
        bbProjectId: "bb-proj-1",
        bbProjectName: "Proj",
        threadId: "thread-live",
        bbThreadTitle: "Live, in progress",
        isAlive: true,
        isWorking: true,
      },
      {
        session: "sess_idle1",
        project: "p",
        title: "sess_idle1",
        start: "2026-08-25T08:00:00.000Z",
        end: "2026-08-25T08:02:00.000Z",
        durationSec: 120,
        totalTokens: 1000,
        totalCost: 0.05,
        workflowCount: 0,
        bins: [{ t: "2026-08-25T08:00:00.000Z", agents: [{ key: "main", total: 1000 }] }],
        cwd: null,
        gitBranch: null,
        events: [],
        bbProjectId: "bb-proj-1",
        bbProjectName: "Proj",
        threadId: "thread-idle",
        bbThreadTitle: "Live, idle",
        isAlive: true,
        isWorking: false,
      },
      {
        session: "sess_dead1",
        project: "p",
        title: "sess_dead1",
        start: "2026-08-25T07:00:00.000Z",
        end: "2026-08-25T07:01:00.000Z",
        durationSec: 60,
        totalTokens: 500,
        totalCost: 0.01,
        workflowCount: 0,
        bins: [{ t: "2026-08-25T07:00:00.000Z", agents: [{ key: "main", total: 500 }] }],
        cwd: null,
        gitBranch: null,
        events: [],
        bbProjectId: "bb-proj-1",
        bbProjectName: "Proj",
        threadId: "thread-dead",
        bbThreadTitle: "Archived",
        isAlive: false,
        isWorking: false,
      },
    ],
    agentLabels: { main: "Main agent" },
  };

  it("paints a live thread's title green and an archived thread's title with the default foreground", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => LIVENESS_READY });

    const liveTitle = await screen.findByRole("button", { name: "Live, in progress" });
    expect(liveTitle.className).toContain("text-success");
    expect(liveTitle.className).not.toContain("text-foreground");

    const deadTitle = screen.getByRole("button", { name: "Archived" });
    expect(deadTitle.className).toContain("text-foreground");
    expect(deadTitle.className).not.toContain("text-success");
  });

  it("shows one blinking dot — only on the thread that is working right now", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => LIVENESS_READY });
    await screen.findByRole("button", { name: "Live, in progress" });

    const dots = screen.getAllByLabelText("In progress");
    expect(dots).toHaveLength(1);
    expect(dots[0].className).toContain("animate-pulse");
    expect(dots[0].className).toContain("bg-success");

    // The dot sits inside the working thread's card, next to its title.
    const workingCard = screen.getByRole("button", { name: "Live, in progress" }).closest(".rounded-md.border.border-border");
    expect(workingCard!.contains(dots[0])).toBe(true);
  });
});
