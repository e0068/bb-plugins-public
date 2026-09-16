// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

/** Show the value to the contract's schema — same trick as contract-sync.test.tsx in the sibling plugin. */
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
    { key: "main", name: "Main agent", caption: "opus 700", total: 700, cost: 0.2 },
    { key: "agent-a11", name: "code-reviewer", caption: "code-reviewer · opus 300", total: 300, cost: 0.1 },
  ],
  agent: {
    key: "main",
    agentType: null,
    description: "Leads the session",
    model: "opus",
    spawnDepth: 0,
    promptExcerpt: "Check the simplification of the distort function.",
    requestFull: "Check the simplification of the distort function. Give a full breakdown.",
    requestFullTruncated: false,
    responseFull: "Done, breakdown below. Everything is covered by tests.",
    responseFullTruncated: false,
  },
  events: [
    { ts: "2026-08-25T09:14:02.000Z", kind: "hook" as const, hookName: "SessionStart:startup", hookEvent: "SessionStart" },
    {
      ts: "2026-08-25T09:14:03.000Z",
      kind: "message" as const,
      role: "user" as const,
      text: "Starting the analysis.",
      fullText: "Starting the analysis. Look at the distort function and its use sites across the signal module.",
      fullTextTruncated: false,
    },
    { ts: "2026-08-25T09:14:05.000Z", kind: "tool" as const, name: "Read", target: "signal/distort.ts" },
    {
      ts: "2026-08-25T09:14:20.000Z",
      kind: "message" as const,
      role: "assistant" as const,
      text: "Done, breakdown below.",
      fullText: "Done, breakdown below. Full response text with all the details of the finding and the proposed patch.",
      fullTextTruncated: true,
      tokens: 452,
      cost: 0.0123,
    },
  ],
  mergeEvents: [],
};

async function renderAgentDetail(subPath: string, rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>>) {
  const app = await loadPluginApp(() => import("../app"));
  // "Agent breakdown" isn't a nav panel of its own — it's the
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

    await screen.findByText("Total tokens");
    await screen.findByText("Check the simplification of the distort function.");
    // Both events tied to the "main" agent and the left panel's own row for it show up.
    expect(screen.getAllByText("Main agent").length).toBeGreaterThan(0);

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
              cwd: null,
              gitBranch: null,
              events: [],
              bbProjectId: null,
              bbProjectName: null,
              threadId: null,
              bbThreadTitle: null,
            },
          ],
          agentLabels: { main: "Main agent", "workflow:wf_1": "arch-review" },
        };
      },
    });

    await screen.findByText("Session chart");
    // The chart is the reused feed frame (ThreadRow) — the per-agent legend
    // lives in the column hover tooltip, where the workflow-merged segment
    // reads as a Workflow with its human name.
    const column = slot.container.querySelector(".relative.h-full.min-w-\\[2px\\]") as HTMLElement;
    fireEvent.mouseMove(column, { clientX: 10, clientY: 10 });
    await screen.findByText(/Workflow: arch-review/);
  });

  it("splits a workflow into member agents and persists the choice when the Workflow toggle is switched off", async () => {
    const inputs: unknown[] = [];
    let savedInput: unknown;
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: async (input) => {
        inputs.push(input);
        return threadsTimelineWithWorkflowMembers();
      },
      saveVizSettings: async (input) => {
        savedInput = input;
        return { ok: true as const };
      },
    });

    await screen.findByText("Session chart");
    // The chart's first fetch groups workflows (its original, default behaviour).
    expect(inputs[0]).toEqual({ limit: 1, unit: 60, session: "sess_abc123", groupWorkflows: true });

    fireEvent.click(await screen.findByRole("button", { name: /Workflow:\s*merged/ }));

    // Switching the toggle re-fetches the same slice split by member agent...
    await waitFor(() => expect(inputs.some((i) => (i as { groupWorkflows?: boolean }).groupWorkflows === false)).toBe(true));
    const last = inputs[inputs.length - 1];
    expect(last).toEqual({ limit: 1, unit: 60, session: "sess_abc123", groupWorkflows: false });
    assertMatchesContract("threadsTimeline", last);

    // ...and persists the choice into viz-settings.
    await waitFor(() => expect(savedInput).toBeDefined());
    expect((savedInput as { agentDetail: { groupWorkflows: boolean } }).agentDetail.groupWorkflows).toBe(false);
    expect(slot.rpcCalls.some((call) => call.method === "saveVizSettings")).toBe(true);
  });

  it("hides the Workflow toggle when the session ran no workflow", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: threadsTimelineTwoAgents,
    });

    await screen.findByText("Session chart");
    expect(screen.queryByRole("button", { name: /Workflow:\s*(merged|split)/ })).toBeNull();
  });

  /** Two real (non-workflow) agent segments in one bin, for the fade-on-select tests below. */
  async function threadsTimelineTwoAgents() {
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
          workflowCount: 0,
          bins: [
            {
              t: "2026-08-25T09:00:00.000Z",
              agents: [
                { key: "main", total: 100 },
                { key: "agent-a11", total: 200 },
              ],
            },
          ],
          cwd: null,
          gitBranch: null,
          events: [],
          bbProjectId: null,
          bbProjectName: null,
          threadId: null,
          bbThreadTitle: null,
        },
      ],
      agentLabels: { main: "Main agent", "agent-a11": "code-reviewer" },
    };
  }

  it("fades the session chart's other-agent segments to 40% opacity when the URL's agent is \"main\" (the default on arrival)", async () => {
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: threadsTimelineTwoAgents,
    });

    await screen.findByText("Session chart");
    // Full aria-label (name + token count) to pick the chart's own segment
    // button, not the left panel's identically-named agent row.
    const mainSegment = screen.getByRole("button", { name: /Main agent: 100 tokens/ });
    const otherSegment = screen.getByRole("button", { name: /code-reviewer: 200 tokens/ });
    expect(mainSegment.className).not.toContain("opacity-40");
    expect(otherSegment.className).toContain("opacity-40");
    // Sanity: this isn't just the DOM query resolving the same element twice.
    expect(slot.container.contains(mainSegment)).toBe(true);
    expect(mainSegment).not.toBe(otherSegment);
  });

  it("fades the session chart's other-agent segments to the OTHER side once the URL already names that agent (arriving via a segment click or the main Usage Analytics page)", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-a11" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: threadsTimelineTwoAgents,
    });

    await screen.findByText("Session chart");
    // Full aria-label (name + token count) to pick the chart's own segment
    // button, not the left panel's identically-named agent row.
    const mainSegment = screen.getByRole("button", { name: /Main agent: 100 tokens/ });
    const otherSegment = screen.getByRole("button", { name: /code-reviewer: 200 tokens/ });
    expect(mainSegment.className).toContain("opacity-40");
    expect(otherSegment.className).not.toContain("opacity-40");
  });

  /** A workflow-merged segment (see tools/threads_timeline.py's `members`) alongside a plain main segment. */
  async function threadsTimelineWithWorkflowMembers() {
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
                { key: "workflow:wf_1", total: 200, members: ["agent-x11", "agent-y22"] },
              ],
            },
          ],
          cwd: null,
          gitBranch: null,
          events: [],
          bbProjectId: null,
          bbProjectName: null,
          threadId: null,
          bbThreadTitle: null,
        },
      ],
      agentLabels: { main: "Main agent", "workflow:wf_1": "arch-review" },
    };
  }

  it("does NOT fade a workflow-merged segment when the URL's agent is one of its real members", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-x11" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: threadsTimelineWithWorkflowMembers,
    });

    await screen.findByText("Session chart");
    const workflowSegment = screen.getByRole("button", { name: /Workflow: arch-review: 200 tokens/ });
    const mainSegment = screen.getByRole("button", { name: /Main agent: 100 tokens/ });
    expect(workflowSegment.className).not.toContain("opacity-40");
    // The selected agent isn't main itself, so main still fades — only the
    // segment that actually contains the selected agent stays lit.
    expect(mainSegment.className).toContain("opacity-40");
  });

  it("fades a workflow-merged segment when the URL's agent took no part in that workflow run", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-z99" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: threadsTimelineWithWorkflowMembers,
    });

    await screen.findByText("Session chart");
    const workflowSegment = screen.getByRole("button", { name: /Workflow: arch-review: 200 tokens/ });
    expect(workflowSegment.className).toContain("opacity-40");
  });

  it("clicking a plain agent segment on the session's own chart re-navigates with the bin's from/to window, not just the agent", async () => {
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-x11" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: threadsTimelineWithWorkflowMembers,
    });

    await screen.findByText("Session chart");
    fireEvent.click(screen.getByRole("button", { name: /Main agent: 100 tokens/ }));

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: {
        subPath: buildAgentDetailSubPath({
          session: "sess_abc123",
          agent: "main",
          from: "2026-08-25T09:00:00.000Z",
          to: "2026-08-25T09:01:00.000Z",
        }),
        replace: true,
      },
    });
  });

  it("clicking a workflow-merged segment opens the whole run's flow (the workflow key itself), regardless of which agent is currently open", async () => {
    const slot = await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-z99" }), {
      agentTimeline: async () => READY_TIMELINE,
      threadsTimeline: threadsTimelineWithWorkflowMembers,
    });

    await screen.findByText("Session chart");
    fireEvent.click(screen.getByRole("button", { name: /Workflow: arch-review: 200 tokens/ }));

    // No longer picks a single member (that was the pre-flow-view behavior):
    // the segment's own "workflow:<runId>" key is passed through, so the
    // detail page opens the whole run's flow view for it.
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: {
        subPath: buildAgentDetailSubPath({
          session: "sess_abc123",
          agent: "workflow:wf_1",
          from: "2026-08-25T09:00:00.000Z",
          to: "2026-08-25T09:01:00.000Z",
        }),
        replace: true,
      },
    });
  });

  it("renders a workflow selector as the flow view — one section per member agent in order, and highlights the whole member group on the left", async () => {
    const memberInfo = (key: string, description: string) => ({
      key,
      agentType: "general-purpose",
      description,
      model: "sonnet",
      spawnDepth: 1,
      promptExcerpt: null,
      requestFull: null,
      requestFullTruncated: false,
      responseFull: null,
      responseFullTruncated: false,
    });
    const memberMessage = (ts: string, text: string) => ({
      ts,
      kind: "message" as const,
      role: "assistant" as const,
      text,
      fullText: text,
      fullTextTruncated: false,
    });
    const flowTimeline = {
      status: "ready" as const,
      totals: READY_TIMELINE.totals,
      // The left panel lists every agent of the session — including the two
      // workflow members whose rows the flow view highlights as a group.
      agents: [
        { key: "main", name: "Main agent", caption: "opus 700", total: 700, cost: 0.2 },
        { key: "agent-x11", name: "implementer", caption: "implementer · sonnet", total: 200, cost: 0.05 },
        { key: "agent-y22", name: "reviewer", caption: "reviewer · sonnet", total: 100, cost: 0.03 },
      ],
      agent: {
        key: "workflow:wf_1",
        agentType: null,
        description: "arch-review",
        model: null,
        spawnDepth: null,
        promptExcerpt: null,
        requestFull: null,
        requestFullTruncated: false,
        responseFull: null,
        responseFullTruncated: false,
      },
      events: [memberMessage("2026-08-25T09:00:01.000Z", "implementer step"), memberMessage("2026-08-25T09:00:05.000Z", "reviewer step")],
      flow: [
        { agent: memberInfo("agent-x11", "implementer"), events: [memberMessage("2026-08-25T09:00:01.000Z", "implementer step")] },
        { agent: memberInfo("agent-y22", "reviewer"), events: [memberMessage("2026-08-25T09:00:05.000Z", "reviewer step")] },
      ],
      mergeEvents: [],
    };

    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "workflow:wf_1" }), {
      agentTimeline: async () => flowTimeline,
    });

    // Right panel: the run's own header, then each member's events in order.
    await screen.findByText("Workflow: arch-review");
    await screen.findByText("implementer step");
    await screen.findByText("reviewer step");

    // Left panel: both member rows are highlighted as a group, main is not.
    // Query the agent-list buttons (the section headers on the right are
    // plain divs, so a role=button match is unambiguously the left panel).
    const memberRow = (name: RegExp) => screen.getByRole("button", { name });
    expect(memberRow(/implementer · sonnet/).className).toContain("bg-state-active");
    expect(memberRow(/reviewer · sonnet/).className).toContain("bg-state-active");
    expect(memberRow(/Main agent/).className).not.toContain("bg-state-active");
  });

  it("renders tool and message rows from the agent's events with their labels", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
    });

    await screen.findByText("Read");
    await screen.findByText("signal/distort.ts");
    await screen.findByText("Done, breakdown below.");
  });

  it("clicking a message row reveals its full text, not just the short preview already shown inline", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
    });

    const previewRow = await screen.findByText("Done, breakdown below.");
    expect(screen.queryByText(/Full response text with all the details/)).toBeNull();

    fireEvent.click(previewRow);

    await screen.findByText(/Full response text with all the details of the finding and the proposed patch\./);
    // Truncated on this event -> the notice shows.
    await screen.findByText("not everything is shown");
  });

  it("does not show a truncation notice for a row whose full text was not truncated", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
    });

    fireEvent.click(await screen.findByText("Starting the analysis."));

    await screen.findByText(/Look at the distort function/);
    expect(screen.queryByText("not everything is shown")).toBeNull();
  });

  it("shows a toggle that reveals the agent's full request/response text, hidden by default", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
    });

    await screen.findByText("Total tokens");
    expect(screen.queryByText(READY_TIMELINE.agent.requestFull)).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Full content" }));

    await screen.findByText(READY_TIMELINE.agent.requestFull);
    await screen.findByText(READY_TIMELINE.agent.responseFull);

    fireEvent.click(screen.getByRole("button", { name: "Hide content" }));
    expect(screen.queryByText(READY_TIMELINE.agent.requestFull)).toBeNull();
  });

  it("does not show the full-content toggle when the agent has neither a full request nor a full response", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => ({
        ...READY_TIMELINE,
        agent: { ...READY_TIMELINE.agent, requestFull: null, responseFull: null },
      }),
    });

    await screen.findByText("Total tokens");
    expect(screen.queryByRole("button", { name: /Full content/ })).toBeNull();
  });

  it("marks only the truncated side (response) with a notice, leaving the untruncated request unmarked", async () => {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => ({
        ...READY_TIMELINE,
        agent: { ...READY_TIMELINE.agent, responseFullTruncated: true },
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Full content" }));
    await screen.findByText(READY_TIMELINE.agent.responseFull);

    // "Output"/"Input" also label the token-breakdown numbers in the left
    // panel — scope the search to the full-content toggle's own wrapper.
    const fullContentPanel = screen.getByRole("button", { name: "Hide content" }).parentElement!;
    const responseBlock = within(fullContentPanel).getByText("Output").closest("div")!;
    expect(within(responseBlock).getByText("not everything is shown")).toBeTruthy();
    const requestBlock = within(fullContentPanel).getByText("Input").closest("div")!;
    expect(within(requestBlock).queryByText("not everything is shown")).toBeNull();
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

    await screen.findByText(/No session id Claude Code/);
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
      agentDetail: { showHooks: false, relativeTime: true, groupedByTurn: true, groupWorkflows: true },
    };
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => READY_TIMELINE,
      loadVizSettings: async () => loadedSettings,
    });

    await screen.findByText("Total tokens");
    await screen.findByRole("button", { name: /Hooks:\s*off/ });
    await screen.findByRole("button", { name: /Time:\s*relative/ });
    await screen.findByRole("button", { name: /Grouping:\s*by turn/ });
  });

  it("saves the full viz settings (including the loaded threads section, untouched) when a display toggle changes", async () => {
    const loadedSettings: VizSettings = {
      threads: { ...DEFAULT_VIZ_SETTINGS.threads, sortMode: "tokens" },
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

    const hooksToggle = await screen.findByRole("button", { name: /Hooks:\s*on/ });
    fireEvent.click(hooksToggle);

    await waitFor(() => expect(savedInput).toBeDefined());
    expect(savedInput).toEqual({
      threads: loadedSettings.threads,
      agentDetail: { showHooks: false, relativeTime: false, groupedByTurn: false, groupWorkflows: true },
    });
    assertMatchesContract("saveVizSettings", savedInput);
    expect(slot.rpcCalls.some((call) => call.method === "saveVizSettings")).toBe(true);
  });
  /**
   * Two user turns, each with its own tool call and assistant reply — the
   * minimum needed to tell "all prompts" apart from "this one prompt", and
   * to check that a turn's tools stay behind the turn's own arrow.
   */
  const TWO_TURN_TIMELINE = {
    ...READY_TIMELINE,
    events: [
      {
        ts: "2026-08-25T09:14:03.000Z",
        kind: "message" as const,
        role: "user" as const,
        text: "Ask one.",
        fullText: "Ask one — the full first prompt.",
        fullTextTruncated: false,
      },
      { ts: "2026-08-25T09:14:05.000Z", kind: "tool" as const, name: "Read", target: "signal/one.ts" },
      {
        ts: "2026-08-25T09:14:20.000Z",
        kind: "message" as const,
        role: "assistant" as const,
        text: "Reply one.",
        fullText: "Reply one — the full first answer.",
        fullTextTruncated: false,
        tokens: 100,
        cost: 0.01,
      },
      {
        ts: "2026-08-25T09:15:03.000Z",
        kind: "message" as const,
        role: "user" as const,
        text: "Ask two.",
        fullText: "Ask two — the full second prompt.",
        fullTextTruncated: false,
      },
      { ts: "2026-08-25T09:15:05.000Z", kind: "tool" as const, name: "Read", target: "signal/two.ts" },
      {
        ts: "2026-08-25T09:15:20.000Z",
        kind: "message" as const,
        role: "assistant" as const,
        text: "Reply two.",
        fullText: "Reply two — the full second answer.",
        fullTextTruncated: false,
        tokens: 200,
        cost: 0.02,
      },
    ],
  };

  async function renderTwoTurns() {
    return renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => TWO_TURN_TIMELINE,
    });
  }

  it("expanding a prompt reveals its own text only — the turn's tools stay with the turn's arrow", async () => {
    await renderTwoTurns();

    fireEvent.click(await screen.findByText("Ask one."));

    await screen.findByText("Ask one — the full first prompt.");
    // The tool shows up once, as its own timeline row: the expanded prompt no
    // longer re-lists the turn's tools underneath itself.
    expect(screen.getAllByText("signal/one.ts")).toHaveLength(1);
  });

  it("the Expand prompts switch expands every user prompt and leaves assistant messages collapsed", async () => {
    await renderTwoTurns();

    fireEvent.click(await screen.findByRole("switch", { name: "Expand prompts" }));

    await screen.findByText("Ask one — the full first prompt.");
    expect(screen.getByText("Ask two — the full second prompt.")).not.toBeNull();
    expect(screen.queryByText("Reply one — the full first answer.")).toBeNull();
    expect(screen.queryByText("Reply two — the full second answer.")).toBeNull();
  });

  it("collapsing one prompt under the switch turns the switch off and keeps the other prompts expanded", async () => {
    await renderTwoTurns();

    const promptSwitch = await screen.findByRole("switch", { name: "Expand prompts" });
    fireEvent.click(promptSwitch);
    await screen.findByText("Ask one — the full first prompt.");

    fireEvent.click(screen.getByText("Ask one."));

    await waitFor(() => expect(promptSwitch.getAttribute("aria-checked")).toBe("false"));
    expect(screen.queryByText("Ask one — the full first prompt.")).toBeNull();
    expect(screen.getByText("Ask two — the full second prompt.")).not.toBeNull();
  });

  it("expands every prompt while the turns themselves stay collapsed", async () => {
    await renderTwoTurns();

    fireEvent.click(await screen.findByRole("button", { name: /Grouping:\s*flat/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Collapse turns" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Expand prompts" }));

    await screen.findByText("Ask one — the full first prompt.");
    expect(screen.getByText("Ask two — the full second prompt.")).not.toBeNull();
    // Everything the turn arrows own — tools and assistant replies — stays folded.
    expect(screen.queryByText("signal/one.ts")).toBeNull();
    expect(screen.queryByText("Reply one.")).toBeNull();
  });

  it("turning the switch back off collapses the prompts again", async () => {
    await renderTwoTurns();

    const promptSwitch = await screen.findByRole("switch", { name: "Expand prompts" });
    fireEvent.click(promptSwitch);
    await screen.findByText("Ask one — the full first prompt.");

    fireEvent.click(promptSwitch);

    await waitFor(() => expect(screen.queryByText("Ask one — the full first prompt.")).toBeNull());
    expect(screen.queryByText("Ask two — the full second prompt.")).toBeNull();
    expect(promptSwitch.getAttribute("aria-checked")).toBe("false");
  });

  /**
   * One turn as the script sends it since every model call is priced once:
   * a call that answered with tools only carries its price on its first tool
   * row, a call with text on its assistant row; hooks sit between them.
   */
  const PRICED_TURN_TIMELINE = {
    ...READY_TIMELINE,
    events: [
      {
        ts: "2026-08-25T09:14:03.000Z",
        kind: "message" as const,
        role: "user" as const,
        text: "Ask priced.",
        fullText: "Ask priced.",
        fullTextTruncated: false,
      },
      { ts: "2026-08-25T09:14:04.000Z", kind: "hook" as const, hookName: "PreToolUse:Read", hookEvent: "PreToolUse" },
      { ts: "2026-08-25T09:14:05.000Z", kind: "tool" as const, name: "Read", target: "signal/priced.ts", tokens: 80_000, cost: 0.2534 },
      { ts: "2026-08-25T09:14:06.000Z", kind: "tool" as const, name: "Grep", target: "unpriced-pattern" },
      { ts: "2026-08-25T09:14:07.000Z", kind: "hook" as const, hookName: "PostToolUse:Read", hookEvent: "PostToolUse" },
      {
        ts: "2026-08-25T09:14:20.000Z",
        kind: "message" as const,
        role: "assistant" as const,
        text: "Priced reply.",
        fullText: "Priced reply.",
        fullTextTruncated: false,
        tokens: 90_000,
        cost: 0.0104,
      },
    ],
  };

  async function renderPricedTurn() {
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "main" }), {
      agentTimeline: async () => PRICED_TURN_TIMELINE,
    });
    return (await screen.findByText("Ask priced.")).closest("[data-ev-index]") as HTMLElement;
  }

  it("shows tokens/cost on every row that carries its call's price — a tool row as well as an assistant row — and nothing on the rest", async () => {
    await renderPricedTurn();

    const toolRow = screen.getByText("signal/priced.ts").closest("[data-ev-index]");
    expect(toolRow?.textContent).toContain("$0.25");
    const assistantRow = screen.getByText("Priced reply.").closest("[data-ev-index]");
    expect(assistantRow?.textContent).toContain("$0.01");
    const unpricedToolRow = screen.getByText("unpriced-pattern").closest("[data-ev-index]");
    expect(unpricedToolRow?.textContent).not.toMatch(/\$/);
  });

  it("a turn header shows the full cost of the turn, tool-priced calls included", async () => {
    await renderPricedTurn();

    fireEvent.click(await screen.findByRole("button", { name: /Grouping:\s*flat/ }));

    const header = (await screen.findByText("Ask priced.")).closest("[data-ev-index]") as HTMLElement;
    expect(header.textContent).toContain("$0.26");
  });

  it("a turn header counts only the rows the Hooks toggle shows", async () => {
    await renderPricedTurn();
    fireEvent.click(await screen.findByRole("button", { name: /Grouping:\s*flat/ }));
    const header = () => screen.getByText("Ask priced.").closest("[data-ev-index]") as HTMLElement;

    await waitFor(() => expect(within(header()).getByText("5")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Hooks:\s*on/ }));

    await waitFor(() => expect(within(header()).getByText("3")).not.toBeNull());
  });

  it("the events caption counts the events the Hooks toggle shows, whether or not the turns are collapsed", async () => {
    await renderPricedTurn();

    await screen.findByText("6 events");
    fireEvent.click(screen.getByRole("button", { name: /Hooks:\s*on/ }));
    await screen.findByText("4 events");

    fireEvent.click(screen.getByRole("button", { name: /Grouping:\s*flat/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Collapse turns" }));

    await waitFor(() => expect(screen.queryByText("signal/priced.ts")).toBeNull());
    expect(screen.getByText("4 events")).not.toBeNull();
  });

  it("a workflow member's section caption counts the events the Hooks toggle shows", async () => {
    const member = {
      key: "agent-x11",
      agentType: "general-purpose",
      description: "implementer",
      model: "sonnet",
      spawnDepth: 1,
      promptExcerpt: null,
      requestFull: null,
      requestFullTruncated: false,
      responseFull: null,
      responseFullTruncated: false,
    };
    const memberEvents = PRICED_TURN_TIMELINE.events;
    await renderAgentDetail(buildAgentDetailSubPath({ session: "sess_abc123", agent: "workflow:wf_1" }), {
      agentTimeline: async () => ({
        ...PRICED_TURN_TIMELINE,
        agent: { ...member, key: "workflow:wf_1", agentType: null, description: "arch-review", model: null, spawnDepth: null },
        flow: [{ agent: member, events: memberEvents }],
      }),
    });
    await screen.findByText("Workflow: arch-review");

    fireEvent.click(screen.getByRole("button", { name: /Hooks:\s*on/ }));

    await waitFor(() => expect(screen.getAllByText("4 events")).toHaveLength(2));
  });
});

describe("token usage header row", () => {
  function unusedHeaderRpcMethod(name: string) {
    return async () => {
      throw new Error(`unexpected call to unstubbed rpc method "${name}" in a header-row test`);
    };
  }

  async function renderHeaderAction(
    rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>>,
    settings?: Record<string, string | boolean>,
  ) {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.threadHeaderActions).toHaveLength(1);
    const [registration] = app.threadHeaderActions;
    const props: PluginThreadHeaderActionProps = { threadId: "thread-1", isCompactViewport: false };
    const fullRpc: PluginRpcTestHandlers<typeof rpcContract> = {
      sessionTokenUsage: unusedHeaderRpcMethod("sessionTokenUsage"),
      agentTimeline: unusedHeaderRpcMethod("agentTimeline"),
      // The popover fetches its own session chart via threadsTimeline (same
      // single-session slice as the session page) once sessionTokenUsage is
      // ready — default to an empty ready slice so that background call
      // neither throws nor renders a chart unless a test opts in.
      threadsTimeline: async () => ({ status: "ready" as const, unit: 60, threads: [], agentLabels: {} }),
      // The popover also loads agentColors from bb.storage.kv on mount (so
      // its session chart's legend matches the feed's) — geometry/behaviour
      // settings (unit, collapseEmpty, …) come from `settings` above via
      // useSettings() instead, not from this kv blob. The popover never
      // writes settings, so saveVizSettings stays an unused poison pill.
      loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
      saveVizSettings: unusedHeaderRpcMethod("saveVizSettings"),
      ...rpc,
    };
    return renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(registration, props, { rpc: fullRpc, settings });
  }

  it("clicking an agent row (the whole row, not a separate \"Details\" button) navigates into the threads panel's agent-detail sub-view", async () => {
    const slot = await renderHeaderAction({
      sessionTokenUsage: async () => ({
        status: "ready",
        sessionId: "sess_abc123",
        totals: READY_TIMELINE.totals,
        agents: READY_TIMELINE.agents,
        truncated: false,
      }),
    });

    const trigger = await screen.findByRole("button", { name: /Token usage/ });
    fireEvent.click(trigger);

    const agentRow = await screen.findByRole("button", { name: /code-reviewer/ });
    // No separate "Details" action inside the row — the whole row is one button.
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    fireEvent.click(agentRow);

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "threads",
      options: { subPath: buildAgentDetailSubPath({ session: "sess_abc123", agent: "agent-a11" }) },
    });
  });

  it("puts the popover body in its own scroll container instead of clipping a long agent list", async () => {
    await renderHeaderAction({
      sessionTokenUsage: async () => ({
        status: "ready",
        sessionId: "sess_abc123",
        totals: READY_TIMELINE.totals,
        agents: READY_TIMELINE.agents,
        truncated: false,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: /Token usage/ }));

    const scrollBody = (await screen.findByText("Total tokens")).closest(".overflow-y-auto");
    expect(scrollBody).not.toBeNull();
    expect(scrollBody!.classList.contains("max-h-[70vh]")).toBe(true);
  });

  it("shows the session chart above the totals, honouring the gear's collapse-empty setting like the feed does", async () => {
    await renderHeaderAction(
      {
        sessionTokenUsage: async () => ({
          status: "ready",
          sessionId: "sess_abc123",
          totals: READY_TIMELINE.totals,
          agents: READY_TIMELINE.agents,
          truncated: false,
        }),
        threadsTimeline: async (input) => {
          assertMatchesContract("threadsTimeline", input);
          return {
            status: "ready" as const,
            unit: 60,
            threads: [
              {
                session: "sess_abc123",
                project: "token-usage-header",
                title: "sess_abc123",
                start: "2026-08-25T09:00:00.000Z",
                end: "2026-08-25T09:04:00.000Z",
                durationSec: 240,
                totalTokens: 2000,
                totalCost: 0.2,
                workflowCount: 0,
                // main, gap, gap, main — collapseEmpty should fold the two
                // consecutive empty bins into one 2-unit gap column, same as
                // the feed's own "Collapse gaps: On" behaviour (see
                // threads-timeline-page.test.tsx) — this test's `settings`
                // option below turns that gear setting on, and the popover's
                // chart follows it exactly like the feed's own rows do.
                bins: [
                  { t: "2026-08-25T09:00:00.000Z", agents: [{ key: "main", total: 1000 }] },
                  { t: "2026-08-25T09:01:00.000Z", agents: [] },
                  { t: "2026-08-25T09:02:00.000Z", agents: [] },
                  { t: "2026-08-25T09:03:00.000Z", agents: [{ key: "main", total: 1000 }] },
                ],
                cwd: null,
                gitBranch: null,
                events: [],
                bbProjectId: null,
                bbProjectName: null,
                threadId: null,
                bbThreadTitle: null,
                isAlive: false,
                isWorking: false,
              },
            ],
            agentLabels: { main: "Main agent" },
          };
        },
      },
      { collapseEmpty: true },
    );

    fireEvent.click(await screen.findByRole("button", { name: /Token usage/ }));

    const scrollBody = (await screen.findByText("Total tokens")).closest(".overflow-y-auto") as HTMLElement;
    await waitFor(() => {
      const columns = scrollBody.querySelectorAll(".relative.h-full.min-w-\\[2px\\]");
      expect(columns.length).toBe(3);
    });
    expect(scrollBody.querySelector('[title*="2 min 0 s break"]')).not.toBeNull();
  });
});
