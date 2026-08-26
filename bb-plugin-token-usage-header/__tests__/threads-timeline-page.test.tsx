// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
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
    throw new Error(`схема метода "${method}" асинхронная — тест этого не ждёт`);
  }
  if (result.issues !== undefined) {
    throw new Error(
      `вход метода "${method}" не проходит контракт: ${JSON.stringify(input)}\n` +
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
      bbProjectId: "bb-proj-1",
      bbProjectName: "Token Usage Header",
      threadId: "thread-aaa",
      bbThreadTitle: "Тред А",
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
  agentLabels: { main: "Главный агент" },
};

// Fixture for the collapseEmpty (\"Схлопнуть пустоты\") feature tests below —
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
      bbProjectId: "bb-proj-1",
      bbProjectName: "Token Usage Header",
      threadId: "thread-collapse",
      bbThreadTitle: "Тред с паузой",
    },
  ],
  agentLabels: { main: "Главный агент" },
};

async function renderThreadsTimeline(rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>>) {
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
  return renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, props, { rpc: fullRpc });
}

// Every control except project filter / sort / search now lives behind the
// gear popover (unit, fill/collapse toggles, width/height, geometry, agent
// colours). Open it before asserting or driving any of those.
async function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Настройки диаграммы" }));
  await screen.findByText("Единица времени");
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

    await screen.findByText("Тред А");
    await screen.findByText(THREAD_B_FALLBACK_TITLE);

    for (const call of slot.rpcCalls) {
      assertMatchesContract(call.method as keyof typeof rpcContract, call.input);
    }
  });

  it("re-fetches with the new unit (and reset limit) when the unit switcher is clicked, still matching the contract", async () => {
    let lastInput: unknown;
    const slot = await renderThreadsTimeline({
      threadsTimeline: async (input) => {
        lastInput = input;
        return { ...THREADS_READY, unit: (input as { unit: number }).unit };
      },
    });
    await screen.findByText("Тред А");

    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "5m" }));

    await screen.findByText("Тред А");
    expect(lastInput).toEqual({ limit: 20, unit: 300 });
    for (const call of slot.rpcCalls) {
      assertMatchesContract(call.method as keyof typeof rpcContract, call.input);
    }
  });

  it("builds the project picker from bbProjectName (real BB projects) plus a \"Threads\" bucket for bbProjectName===null, not the raw directory slug", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

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
    await screen.findByText("Тред А");
    const callsBefore = slot.rpcCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Token Usage Header" }));

    await screen.findByText("Тред А");
    expect(screen.queryByText(THREAD_B_FALLBACK_TITLE)).toBeNull();
    expect(slot.rpcCalls.length).toBe(callsBefore);
  });

  it("filters rows client-side by the \"Threads\" bucket chip (bbProjectName === null)", async () => {
    const slot = await renderThreadsTimeline({
      threadsTimeline: async () => THREADS_READY,
    });
    await screen.findByText("Тред А");
    const callsBefore = slot.rpcCalls.length;

    fireEvent.click(screen.getByRole("button", { name: "Threads" }));

    await screen.findByText(THREAD_B_FALLBACK_TITLE);
    expect(screen.queryByText("Тред А")).toBeNull();
    expect(slot.rpcCalls.length).toBe(callsBefore);
  });

  it("filters rows client-side by search text", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    fireEvent.change(screen.getByPlaceholderText("По названию или ID сессии"), { target: { value: "bbb222" } });

    await screen.findByText(THREAD_B_FALLBACK_TITLE);
    expect(screen.queryByText("Тред А")).toBeNull();
  });

  it("clicking a bar segment navigates to the threads panel's agent-detail sub-view with agent/session/from/to, no threadId", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    const segment = screen.getByLabelText(/code-reviewer: 500 токенов/);
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

  it("shows the human agentLabels name in the gear's agent-colour list, not the raw agent key", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");
    await openSettings();

    // "main" -> agentLabels["main"] = "Главный агент" — the raw key never
    // appears as the agent-colour row's text.
    screen.getByText("Главный агент");
    expect(screen.queryByText("main", { selector: "span.truncate" })).toBeNull();
  });

  it("falls back to the raw agent key in the gear's agent-colour list when agentLabels has no entry for it", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");
    await openSettings();

    // "code-reviewer" has no entry in THREADS_READY.agentLabels.
    screen.getByText("code-reviewer");
  });

  it("labels each agent-colour picker in the gear with the mapped name, not the raw key", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");
    await openSettings();

    // "main" is mapped to "Главный агент"; its colour input is addressed by
    // that human label, never the raw key.
    const input = screen.getByLabelText("Цвет агента Главный агент") as HTMLInputElement;
    expect(input.type).toBe("color");
  });

  it("shows the mapped label (not the raw agent key) in a bar segment's accessible name", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    // Тред А's first bin has a "main" segment (3000 tokens) — "main" is
    // mapped to "Главный агент" in agentLabels, so the segment's aria-label
    // must show that label, not the raw "main" key.
    screen.getByLabelText(/Главный агент: 3\.0k токенов/);
  });

  it("shows the column's time range and a per-agent legend (tokens + %) in an immediate hover tooltip", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Тред А");

    // Тред А's second bin: main 1500 + code-reviewer 500 = 2000 → 75% / 25%.
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    fireEvent.mouseMove(columns[1] as HTMLElement, { clientX: 10, clientY: 10 });

    // Time range of that column (clock is runner-TZ-dependent — assert only
    // the HH:MM–HH:MM shape), and both agents with their token/share split.
    await screen.findByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
    screen.getByText(/1\.5k · 75%/);
    screen.getByText(/500 · 25%/);
  });

  it("keeps the colour/click identity on the raw agent key even though the legend/tooltip show the mapped label", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    // Clicking the "main" segment must still navigate with agent="main" (the
    // raw key), never the display label "Главный агент".
    const segment = screen.getByLabelText(/Главный агент: 3\.0k токенов/);
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

  it("exposes numeric gap/radius controls and a frame-lift colour picker in the gear popover that live-update the chart", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    await openSettings();

    await screen.findByLabelText("Отступ между столбцами");
    await screen.findByLabelText("Отступ между сегментами");
    await screen.findByLabelText("Скругление столбца");
    const segRadiusInput = screen.getByLabelText("Скругление сегмента") as HTMLInputElement;
    const colorInput = screen.getByLabelText("Цвет высветления фрейма графика") as HTMLInputElement;
    expect(colorInput.type).toBe("color");

    fireEvent.change(segRadiusInput, { target: { value: "6" } });
    fireEvent.change(colorInput, { target: { value: "#112233" } });

    const segment = screen.getByLabelText(/code-reviewer: 500 токенов/) as HTMLElement;
    await waitFor(() => expect(segment.style.borderRadius).toBe("6px"));

    const row = segment.closest(".rounded-md.border.border-border") as HTMLElement | null;
    expect(row?.style.backgroundColor).toBe("rgba(17, 34, 51, 0.05)");
  });

  it("hydrates the row-1 controls from loadVizSettings on mount and re-fetches with the persisted unit", async () => {
    const loadedSettings: VizSettings = {
      threads: { ...DEFAULT_VIZ_SETTINGS.threads, unit: 900, sortMode: "duration" },
      agentDetail: DEFAULT_VIZ_SETTINGS.agentDetail,
    };
    let lastInput: unknown;
    await renderThreadsTimeline({
      threadsTimeline: async (input) => {
        lastInput = input;
        return { ...THREADS_READY, unit: (input as { unit: number }).unit };
      },
      loadVizSettings: async () => loadedSettings,
    });

    await screen.findByText("Тред А");
    await waitFor(() => expect(lastInput).toEqual({ limit: 20, unit: 900 }));
    await openSettings();
    expect(screen.getByRole("button", { name: "15m" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("saves the full viz settings (including the loaded agentDetail section, untouched) when a row-1 control changes", async () => {
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
    await screen.findByText("Тред А");

    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "5m" }));

    await waitFor(() => expect(savedInput).toBeDefined());
    expect((savedInput as VizSettings).agentDetail).toEqual(loadedSettings.agentDetail);
    expect((savedInput as VizSettings).threads.unit).toBe(300);
    assertMatchesContract("saveVizSettings", savedInput);
  });

  it("shows the BB thread's human title as the card header, not the raw session id duplicated", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });

    await screen.findByText("Тред А");
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
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    // Тред А: 300s, 2 bins. Тред Б (fallback title): 120s, 1 bin — the old
    // widthFractions-driven card width would have made this one much
    // narrower; now both cards must be identically full-width.
    const titleA = await screen.findByText("Тред А");
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

  it("keeps the card at a constant full width even when a huge fixed colWidthPx (fillWidth off) would blow the graph itself far past the container", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    // Тред А has 2 bins, so even 2*700 + 1*colGap comfortably exceeds the
    // jsdom fallback container width — this now overflows only the graph's
    // own scroll wrapper inside the card, never the card itself.
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Выкл" }));
    const colWidthInput = screen.getByLabelText("Ширина столбца, пикселей");
    fireEvent.change(colWidthInput, { target: { value: "700" } });

    const title = await screen.findByText("Тред А");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.classList.contains("w-full")).toBe(true);
    expect(card!.style.width).toBe("");
  });

  it("wraps the graph in its own overflow-x-auto scroll container inside the card, sized to bins*colWidthPx+gaps when fillWidth is off", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Выкл" }));
    const colWidthInput = screen.getByLabelText("Ширина столбца, пикселей");
    fireEvent.change(colWidthInput, { target: { value: "700" } });

    const title = await screen.findByText("Тред А");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const scrollWrapper = card.querySelector(".overflow-x-auto") as HTMLElement | null;
    expect(scrollWrapper).not.toBeNull();
    const graph = scrollWrapper!.querySelector(".flex.items-end") as HTMLElement;
    // Тред А: 2 bins * 700px + 1 gap * default colGap (1px) = 1401px — far
    // past the card, so this width can only ever fit via the wrapper's own
    // horizontal scroll, not by stretching the card.
    expect(graph.style.width).toBe("1401px");
  });

  it("sizes the graph to 100% of the card (no overflow wrapper needed) when fillWidth is on", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Тред А");

    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const graph = card.querySelector(".flex.items-end") as HTMLElement;
    expect(graph.style.width).toBe("100%");
  });

  it("sizes each bin column to a fixed colWidthPx (not a shared fraction) when fillWidth is off, labelled px/стб", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Выкл" }));
    screen.getByText("px/стб");
    const colWidthInput = screen.getByLabelText("Ширина столбца, пикселей") as HTMLInputElement;
    fireEvent.change(colWidthInput, { target: { value: "12" } });

    const title = await screen.findByText("Тред А");
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    // Тред А has 2 bins — each fixed-width column reports its own inline
    // width, independent of the other columns or the card's own width.
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    expect(columns.length).toBe(2);
    columns.forEach((col) => {
      expect((col as HTMLElement).style.width).toBe("12px");
      expect((col as HTMLElement).style.flexShrink).toBe("0");
    });
  });

  it("gives every bin column a uniform fixed width (calc of 100%/maxBinCount, not flex-1) when fillWidth is on", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Тред А");

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

  it("saves colWidthPx (not pxPerSecond) when the width control changes with fillWidth off", async () => {
    let savedInput: unknown;
    await renderThreadsTimeline({
      threadsTimeline: async () => THREADS_READY,
      saveVizSettings: async (input) => {
        savedInput = input;
        return { ok: true as const };
      },
    });
    await screen.findByText("Тред А");

    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Выкл" }));
    const colWidthInput = screen.getByLabelText("Ширина столбца, пикселей");
    fireEvent.change(colWidthInput, { target: { value: "15" } });

    await waitFor(() => expect((savedInput as VizSettings | undefined)?.threads.colWidthPx).toBe(15));
    expect((savedInput as VizSettings).threads).not.toHaveProperty("pxPerSecond");
    assertMatchesContract("saveVizSettings", savedInput);
  });

  it("keeps one column per bin, each empty bin with its own single-unit gap tooltip, when Схлопнуть пустоты is off (default)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_WITH_GAPS });
    const title = await screen.findByText("Тред с паузой");

    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
    expect(columns.length).toBe(4);
    // Two separate empty bins — each its own column, each its own
    // single-unit gap tooltip (not summed into one).
    expect(screen.getAllByTitle(/перерыв 1 мин 0 с/)).toHaveLength(2);
  });

  it("collapses consecutive empty bins into one gap column carrying the summed break duration when Схлопнуть пустоты is Вкл", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_WITH_GAPS });
    const title = await screen.findByText("Тред с паузой");

    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Схлопнуть пустоты: Вкл" }));

    await waitFor(() => {
      const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
      const columns = card.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
      expect(columns.length).toBe(3);
    });
    screen.getByTitle(/перерыв 2 мин 0 с/);
  });

  it("keeps the feed a plain vertical list — no feed-level horizontal scroll container", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    expect(slot.container.querySelector("section.overflow-x-auto")).toBeNull();
  });

  it("shows the thread's cost ($) in the card header and no longer the word «токенов» there", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Тред А");

    // Тред А's totalCost is 0.42 → "$0.42"; the card header no longer labels
    // the raw token count with the word «токенов» (the page subtitle still may).
    const card = title.closest(".rounded-md.border.border-border") as HTMLElement;
    expect(card.textContent).toContain("$0.42");
    expect(card.textContent).not.toContain("токенов");
  });

  it("shows how many workflows and agents took part, to the left of the duration", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    // Тред А: workflowCount 2; two distinct agent keys across its bins (main +
    // code-reviewer) → "2 agents".
    screen.getByText(/2 workflows · 2 agents/);
  });

  it("opens the matched BB thread when its card title is clicked", async () => {
    const slot = await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    fireEvent.click(screen.getByRole("button", { name: "Тред А" }));

    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thread-aaa" });
  });

  it("leaves the title non-clickable for a session with no BB thread match (the «Threads» bucket)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText(THREAD_B_FALLBACK_TITLE);

    // Тред Б has threadId === null — its title is plain text, not a button.
    expect(screen.queryByRole("button", { name: THREAD_B_FALLBACK_TITLE })).toBeNull();
  });

  it("filters threads by a minimum cost bound (от)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    // Тред А $0.42, Тред Б $0.05 — a 0.1 floor drops Б, keeps А.
    fireEvent.change(screen.getByLabelText("Стоимость от, USD"), { target: { value: "0.1" } });

    await waitFor(() => expect(screen.queryByText(THREAD_B_FALLBACK_TITLE)).toBeNull());
    screen.getByText("Тред А");
  });

  it("filters threads by a maximum cost bound (до)", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    await screen.findByText("Тред А");

    // A 0.1 ceiling drops Тред А ($0.42), keeps Тред Б ($0.05).
    fireEvent.change(screen.getByLabelText("Стоимость до, USD"), { target: { value: "0.1" } });

    await waitFor(() => expect(screen.queryByText("Тред А")).toBeNull());
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
    expect((screen.getByPlaceholderText("По названию или ID сессии") as HTMLInputElement).value).toBe("bbb222");
    expect(screen.queryByText("Тред А")).toBeNull();
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
    await screen.findByText("Тред А");

    fireEvent.change(screen.getByLabelText("Стоимость от, USD"), { target: { value: "0.1" } });

    await waitFor(() => expect((saved as VizSettings | undefined)?.threads.costMin).toBe("0.1"));
    assertMatchesContract("saveVizSettings", saved);
  });

  it("fades the column tooltip out over ~200ms after the pointer leaves, then unmounts it", async () => {
    await renderThreadsTimeline({ threadsTimeline: async () => THREADS_READY });
    const title = await screen.findByText("Тред А");
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
