// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps, PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../server";
// Pure schema/defaults module (zod-only, no bb SDK) — safe to import
// statically even though this file otherwise avoids static imports from the
// plugin's own modules (see the comment below on buildAgentDetailSubPath).
import { DEFAULT_VIZ_SETTINGS, type VizSettings } from "../src/core";

afterEach(cleanup);

// Deliberately NOT imported from ../pages/AgentTimelinePage: that module
// (transitively, via ../app.tsx re-exporting it) imports
// "@get-bb/plugin-sdk/app" at its top, and that module binds its exports
// (definePluginApp, useRpc, …) from `globalThis.__bbPluginRuntime` the
// moment it's first evaluated — see installTestPluginRuntime's doc comment.
// A static top-level import here would evaluate it before loadPluginApp
// gets a chance to install the test runtime, leaving every SDK hook bound
// to `undefined`. Mirroring the encoding by hand (it's a one-line
// URLSearchParams builder) keeps this file import-order-safe.
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

/** Показать значение схеме контракта — тот же приём, что и в contract-sync.test.tsx соседнего плагина. */
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
    throw new Error(`unexpected call to unstubbed rpc method "${name}" in an agent-timeline-page test`);
  };
}

const READY_TIMELINE = {
  status: "ready" as const,
  totals: {
    total: 1000,
    input: 200,
    cacheWrite: 100,
    cacheRead: 600,
    output: 90,
    thinking: 10,
    cost: 0.3,
    costs: { input: 0.05, cacheWrite: 0.02, cacheRead: 0.1, output: 0.12, thinking: 0.01 },
    messages: 5,
  },
  agents: [
    { key: "main", name: "Главный агент", caption: "opus 700", total: 700, cost: 0.2 },
    { key: "agent-a11", name: "code-reviewer", caption: "code-reviewer · opus 300", total: 300, cost: 0.1 },
  ],
  agent: {
    key: "main",
    agentType: null,
    description: "Ведёт сессию",
    model: "opus",
    spawnDepth: 0,
    promptExcerpt: "Проверь упрощение функции distort.",
  },
  events: [
    { ts: "2026-08-25T09:14:02.000Z", kind: "hook" as const, hookName: "SessionStart:startup", hookEvent: "SessionStart" },
    { ts: "2026-08-25T09:14:03.000Z", kind: "message" as const, role: "user" as const, text: "Начинаем разбор." },
    { ts: "2026-08-25T09:14:05.000Z", kind: "tool" as const, name: "Read", target: "signal/distort.ts" },
    {
      ts: "2026-08-25T09:14:20.000Z",
      kind: "message" as const,
      role: "assistant" as const,
      text: "Готово, разбор ниже.",
      tokens: 452,
      cost: 0.0123,
    },
  ],
};

async function renderAgentDetail(subPath: string, rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>>) {
  const app = await loadPluginApp(() => import("../app"));
  // "Детализация агента" isn't a nav panel of its own — it's the
  // subPath !== "" sub-view rendered inside the single "threads-timeline"
  // panel (see app.tsx's ThreadsTimelinePanel router).
  const registration = app.navPanels.find((p) => p.id === "threads-timeline");
  if (!registration) throw new Error("threads-timeline nav panel is not registered");
  const props: PluginNavPanelProps = { subPath };
  const fullRpc: PluginRpcTestHandlers<typeof rpcContract> = {
    sessionTokenUsage: unusedRpcMethod("sessionTokenUsage"),
    agentTimeline: unusedRpcMethod("agentTimeline"),
    // The page fetches its top session chart via threadsTimeline (single-session
    // slice); default to an empty ready slice so that background call neither
    // throws nor renders a chart unless a test opts in.
    threadsTimeline: async () => ({ status: "ready" as const, unit: 60, threads: [], agentLabels: {} }),
    loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
    saveVizSettings: async () => ({ ok: true as const }),
    ...rpc,
  };
  return renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, props, { rpc: fullRpc });
}

describe("threads-timeline panel — agent-detail sub-view", () => {
  it("registers a single nav panel (\"threads-timeline\"), not a separate agent-detail panel", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.navPanels.map((p) => p.id)).toEqual(["threads-timeline"]);
    expect(app.navPanels[0].path).toBe("threads");
  });

  it("clicking the back link returns to the feed (empty subPath) on the same panel", async () => {
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
    });

    fireEvent.click(screen.getByRole("button", { name: /Usage Analytics/ }));

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: { subPath: "" },
    });
  });

  it("with a session id, fetches the agent's timeline (session-wide totals/agents included in the same ready response), matching the rpc contract", async () => {
    const subPath = buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" });
    const slot = await renderAgentDetail(subPath, {
      agentTimeline: async (input) => {
        expect(input).toEqual({ session: "sess_abc123", agent: "main" });
        return READY_TIMELINE;
      },
    });

    await screen.findByText("Всего токенов");
    await screen.findByText("Проверь упрощение функции distort.");
    // Both events tied to the "main" agent and the left panel's own row for it show up.
    expect(screen.getAllByText("Главный агент").length).toBeGreaterThan(0);

    expect(slot.rpcCalls.length).toBeGreaterThan(0);
    // The left panel's breakdown is fed from the agentTimeline response (no
    // second sessionTokenUsage round trip); the only other calls are the
    // mount-time viz-settings load and the top session chart's threadsTimeline
    // slice.
    expect(
      slot.rpcCalls.every(
        (call) => call.method === "agentTimeline" || call.method === "loadVizSettings" || call.method === "threadsTimeline",
      ),
    ).toBe(true);
    expect(slot.rpcCalls.some((call) => call.method === "agentTimeline")).toBe(true);
    for (const call of slot.rpcCalls) {
      assertMatchesContract(call.method as keyof typeof rpcContract, call.input);
    }
  });

  it("renders the top session bar chart, grouping a workflow run into one segment labelled by workflow name", async () => {
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: async (input) => {
        // The page asks for this session's own slice, workflow-grouped.
        expect(input).toEqual({ limit: 1, unit: 60, session: "sess_abc123", groupWorkflows: true });
        return {
          status: "ready" as const,
          unit: 60,
          threads: [
            {
              session: "sess_abc123",
              project: "p",
              title: "sess_abc123",
              start: "2026-08-25T09:00:00.000Z",
              end: "2026-08-25T09:01:00.000Z",
              durationSec: 60,
              totalTokens: 300,
              totalCost: 0.1,
              workflowCount: 1,
              bins: [
                {
                  t: "2026-08-25T09:00:00.000Z",
                  agents: [
                    { key: "main", total: 100 },
                    { key: "workflow:wf_1", total: 200 },
                  ],
                },
              ],
              bbProjectId: null,
              bbProjectName: null,
              threadId: null,
              bbThreadTitle: null,
            },
          ],
          agentLabels: { main: "Главный агент", "workflow:wf_1": "arch-review" },
        };
      },
    });

    await screen.findByText("Диаграмма сессии");
    // The chart is the reused feed frame (ThreadRow) — the per-agent legend
    // lives in the column hover tooltip, where the workflow-merged segment
    // reads as a Workflow with its human name.
    const column = slot.container.querySelector(".relative.h-full.min-w-\\[2px\\]") as HTMLElement;
    fireEvent.mouseMove(column, { clientX: 10, clientY: 10 });
    await screen.findByText(/Workflow: arch-review/);
  });

  it("renders tool and message rows from the agent's events with their labels", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
    });

    await screen.findByText("Read");
    await screen.findByText("signal/distort.ts");
    await screen.findByText("Готово, разбор ниже.");
  });

  it("shows tokens/cost only on assistant message rows, leaving tool/hook rows blank", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
    });

    const assistantRow = (await screen.findByText("Готово, разбор ниже.")).closest("[data-ev-index]");
    expect(assistantRow).not.toBeNull();
    expect(assistantRow?.textContent).toContain("452");
    expect(assistantRow?.textContent).toContain("$0.01");

    const toolRow = (await screen.findByText("signal/distort.ts")).closest("[data-ev-index]");
    expect(toolRow).not.toBeNull();
    // No stray token/cost figure leaking onto a tool row.
    expect(toolRow?.textContent).not.toMatch(/\$/);
  });

  it("clicking a different agent row in the left panel navigates within the panel to that agent, dropping any from/to window", async () => {
    const slot = await renderAgentDetail(
      buildAgentDetailSubPath({ session: "sess_abc123", agent: "main", from: "2026-08-25T09:00:00.000Z", to: "2026-08-25T09:10:00.000Z" }),
      {
        agentTimeline: async () => READY_TIMELINE,
      },
    );

    await screen.findByText("code-reviewer", { selector: "span" });
    fireEvent.click(screen.getByRole("button", { name: /code-reviewer/ }));

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: { subPath: buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-a11" }), replace: true },
    });
  });

  it("without a session id (malformed/stale link), makes no agentTimeline call and explains why", async () => {
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ agent: "main", session: "" }), {});

    await screen.findByText(/Нет id сессии Claude Code/);
    // The mount-time viz-settings load still fires (it doesn't depend on a
    // session) — only the data-fetching call is gated on having one.
    expect(slot.rpcCalls.some((call) => call.method === "agentTimeline")).toBe(false);
  });

  it("shows the server's error status without crashing", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => ({ status: "error" as const, message: "boom" }),
    });

    // Both panels are fed by the same single agentTimeline response, so the
    // error message shows up in both the left breakdown and the right
    // timeline — not a duplication bug.
    await waitFor(() => expect(screen.getAllByText("boom").length).toBe(2));
  });

  it("highlights the events inside a deep-linked from/to window", async () => {
    await renderAgentDetail(
      buildAgentDetailSubPath({
        session: "sess_abc123",
        agent: "main",
        from: "2026-08-25T09:14:04.000Z",
        to: "2026-08-25T09:14:06.000Z",
      }),
      {
        agentTimeline: async () => READY_TIMELINE,
      },
    );

    await screen.findByText("signal/distort.ts");
    await waitFor(() => {
      const readRow = screen.getByText("signal/distort.ts").closest("[data-ev-index]");
      expect(readRow?.className).toContain("border-primary");
    });
  });

  it("hydrates showHooks/relativeTime/groupedByTurn from loadVizSettings on mount", async () => {
    const loadedSettings: VizSettings = {
      ...DEFAULT_VIZ_SETTINGS,
      agentDetail: { showHooks: false, relativeTime: true, groupedByTurn: true },
    };
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
      loadVizSettings: async () => loadedSettings,
    });

    await screen.findByText("Всего токенов");
    await screen.findByRole("button", { name: /Хуки:\s*выкл/ });
    await screen.findByRole("button", { name: /Время:\s*относительное/ });
    await screen.findByRole("button", { name: /Группировка:\s*по ходам/ });
  });

  it("saves the full viz settings (including the loaded threads section, untouched) when a display toggle changes", async () => {
    const loadedSettings: VizSettings = {
      threads: { ...DEFAULT_VIZ_SETTINGS.threads, unit: 300, sortMode: "tokens" },
      agentDetail: DEFAULT_VIZ_SETTINGS.agentDetail,
    };
    let savedInput: unknown;
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
      loadVizSettings: async () => loadedSettings,
      saveVizSettings: async (input) => {
        savedInput = input;
        return { ok: true as const };
      },
    });

    const hooksToggle = await screen.findByRole("button", { name: /Хуки:\s*вкл/ });
    fireEvent.click(hooksToggle);

    await waitFor(() => expect(savedInput).toBeDefined());
    expect(savedInput).toEqual({
      threads: loadedSettings.threads,
      agentDetail: { showHooks: false, relativeTime: false, groupedByTurn: false },
    });
    assertMatchesContract("saveVizSettings", savedInput);
    expect(slot.rpcCalls.some((call) => call.method === "saveVizSettings")).toBe(true);
  });
});

describe("token usage header row", () => {
  function unusedHeaderRpcMethod(name: string) {
    return async () => {
      throw new Error(`unexpected call to unstubbed rpc method "${name}" in a header-row test`);
    };
  }

  async function renderHeaderAction(rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>>) {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.threadHeaderActions).toHaveLength(1);
    const [registration] = app.threadHeaderActions;
    const props: PluginThreadHeaderActionProps = { threadId: "thread-1", isCompactViewport: false };
    const fullRpc: PluginRpcTestHandlers<typeof rpcContract> = {
      sessionTokenUsage: unusedHeaderRpcMethod("sessionTokenUsage"),
      agentTimeline: unusedHeaderRpcMethod("agentTimeline"),
      threadsTimeline: unusedHeaderRpcMethod("threadsTimeline"),
      loadVizSettings: unusedHeaderRpcMethod("loadVizSettings"),
      saveVizSettings: unusedHeaderRpcMethod("saveVizSettings"),
      ...rpc,
    };
    return renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(registration, props, { rpc: fullRpc });
  }

  it("clicking an agent row (the whole row, not a separate \"Детали\" button) navigates into the threads panel's agent-detail sub-view", async () => {
    const slot = await renderHeaderAction({
      sessionTokenUsage: async () => ({
        status: "ready",
        sessionId: "sess_abc123",
        totals: READY_TIMELINE.totals,
        agents: READY_TIMELINE.agents,
        truncated: false,
      }),
    });

    const trigger = await screen.findByRole("button", { name: /Расход токенов/ });
    fireEvent.click(trigger);

    const agentRow = await screen.findByRole("button", { name: /code-reviewer/ });
    // No separate "Детали" action inside the row — the whole row is one button.
    expect(screen.queryByRole("button", { name: "Детали" })).toBeNull();
    fireEvent.click(agentRow);

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: { subPath: buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-a11" }) },
    });
  });
});
