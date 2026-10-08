// @vitest-environment jsdom
// The Flow stage lane under a session's chart: one tag per column a stage
// pass starts in, stretched over the pass and led by one icon, a hover tooltip
// with every pass of the tag — its start, end and duration — and no lane at
// all for a session without a Flow run.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { DEFAULT_VIZ_SETTINGS, type FlowStage } from "../src/core";

afterEach(cleanup);

const at = (minute: number) => `2026-10-08T10:${String(minute).padStart(2, "0")}:00.000Z`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const GLYPH: FlowStage["glyph"] = [["path", { d: "M2 2h20", stroke: "currentColor" }]];

const STAGES: FlowStage[] = [
  {
    id: "prototype",
    name: "Prototype",
    glyph: GLYPH,
    passes: [
      { from: at(0), to: at(3) },
      { from: at(5), to: at(7) },
    ],
  },
  { id: "commit", name: "Commit", glyph: GLYPH, passes: [{ from: at(8), to: "2026-10-08T10:08:20.000Z" }] },
  { id: "review", name: "code-review", glyph: GLYPH, passes: [{ from: "2026-10-08T10:08:30.000Z", to: null }] },
];

const thread = (flowStages: FlowStage[]) => ({
  session: "sess_flow",
  project: "token-usage-header",
  title: "sess_flow",
  start: at(0),
  end: at(9),
  durationSec: 540,
  totalTokens: 10_000,
  totalCost: 1,
  workflowCount: 0,
  bins: Array.from({ length: 10 }, (_, minute) => ({ t: at(minute), agents: [{ key: "main", total: 1000 }] })),
  cwd: null,
  gitBranch: null,
  events: [],
  bbProjectId: "bb-proj-1",
  bbProjectName: "bb-plugins",
  threadId: "thread-flow",
  bbThreadTitle: "Markers",
  isAlive: true,
  isWorking: false,
  flowStages,
});

async function renderFeed(flowStages: FlowStage[]) {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
  const rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {
    threadsTimeline: async () => ({ status: "ready" as const, unit: 60, threads: [thread(flowStages)], agentLabels: {}, truncated: false }),
    loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
    saveVizSettings: async () => ({ ok: true as const }),
  };
  renderSlot<PluginNavPanelProps, typeof rpcContract>(registration, { subPath: "" }, { rpc: rpc as PluginRpcTestHandlers<typeof rpcContract> });
  await screen.findByRole("button", { name: "Markers" });
}

const chips = () => screen.queryAllByRole("img", { name: /^Flow stage/ });

describe("Flow stage lane under the session chart", () => {
  it("one tag per column a pass starts in, named by its first pass", async () => {
    await renderFeed(STAGES);
    expect(chips().map((m) => m.getAttribute("aria-label"))).toEqual([
      "Flow stage Prototype, pass 1 of 2",
      "Flow stage Prototype, pass 2 of 2",
      "Flow stage Commit and 1 more",
    ]);
  });

  it("a column shows one icon even when several passes start in it", async () => {
    await renderFeed(STAGES);
    expect(chips()[2]!.querySelectorAll("svg")).toHaveLength(1);
  });

  it("hovering a tag shows its pass's name, start–end on one line and the duration under it, without labels", async () => {
    await renderFeed(STAGES);
    fireEvent.mouseMove(chips()[1]!, { clientX: 10, clientY: 10 });
    const tip = within(await screen.findByRole("tooltip"));
    expect(tip.getByText("Prototype")).toBeTruthy();
    expect(tip.getByText("pass 2 of 2")).toBeTruthy();
    expect(tip.getByText(`${clock(at(5))}–${clock(at(7))}`)).toBeTruthy();
    expect(tip.getByText("2 min 0 s")).toBeTruthy();
    expect(tip.queryByText("Started")).toBeNull();
    expect(tip.queryByText("Duration")).toBeNull();
  });

  it("the tooltip lists every stage of the tag, the running one says so instead of an end time", async () => {
    await renderFeed(STAGES);
    fireEvent.mouseMove(chips()[2]!, { clientX: 10, clientY: 10 });
    const tip = within(await screen.findByRole("tooltip"));
    expect(tip.getByText("Commit")).toBeTruthy();
    expect(tip.getByText("code-review")).toBeTruthy();
    expect(tip.getByText("20 s")).toBeTruthy();
    expect(tip.getByText(`${clock("2026-10-08T10:08:30.000Z")}–running`)).toBeTruthy();
  });

  it("a session without a Flow run has no stage lane at all", async () => {
    await renderFeed([]);
    expect(chips()).toEqual([]);
    expect(screen.queryByTestId("flow-stage-lane")).toBeNull();
  });
});
