import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { sumTotals, type ThreadEntry, type ThreadsTimeline, type TokensReport } from "../../core";
import { createThreadFamilyService, MAX_FAMILY_MEMBERS } from "../thread-family-service";
import type { ThreadsTimelineService } from "../threads-timeline-service";
import type { TokenUsageService } from "../token-usage-service";
import type { TokensQueryParams, TokensRunResult } from "../types";

const COSTS = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };

/** A report whose only interesting numbers are the tokens and the cost. */
function report(total: number, cost: number): TokensReport {
  return {
    by: "agent",
    buckets: [],
    totals: { total, input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, thinking: 0, messages: 1, cost, costs: { ...COSTS, output: cost }, models: [], buckets: 1 },
    truncated: false,
  };
}

function entry(session: string): ThreadEntry {
  return {
    session, project: "p", title: session, start: "2026-10-23T10:00:00.000Z", end: "2026-10-23T11:00:00.000Z", durationSec: 3600, activeSec: 3600, waitingSec: 0,
    totalTokens: 0, totalCost: 0, workflowCount: 0, bins: [], cwd: null, gitBranch: null, events: [],
    bbProjectId: null, bbProjectName: null, threadId: null, bbThreadTitle: null, isAlive: true, isWorking: false, flowStages: [],
  };
}

/** One row of bb.sdk.threads.list — only what the family reads. */
const row = (id: string, parentThreadId: string | null, title: string | null = id) => ({ id, parentThreadId, title, titleFallback: null });

interface World {
  threads: ReadonlyArray<ReturnType<typeof row>>;
  /** thread id → its current session; a thread absent here has not started a session. */
  sessions?: Record<string, string>;
  /** session → [tokens, cost]; a session absent here fails to be counted. */
  usage?: Record<string, [number, number]>;
  /** sessions whose chart fails to build. */
  chartFails?: readonly string[];
}

function setup(world: World) {
  const { bb, harness } = createFakePluginHost();
  harness.sdk.stub("threads.list", async () => world.threads);
  const tokenUsage: TokenUsageService = {
    resolveSessionId: vi.fn(async (threadId: string) => world.sessions?.[threadId] ?? null),
    query: vi.fn(async (params: TokensQueryParams): Promise<TokensRunResult> => {
      const usage = world.usage?.[params.session ?? ""];
      return usage ? { ok: true, data: report(usage[0], usage[1]) } : { ok: false, reason: "script_error", message: "no such session" };
    }),
    clearCache: vi.fn(),
  };
  const threadsTimeline: ThreadsTimelineService = {
    query: vi.fn(async (params) =>
      world.chartFails?.includes(params.session ?? "")
        ? ({ ok: false, reason: "script_error", message: "chart failed" } as const)
        : ({ ok: true, data: { schemaVersion: 8, unit: params.unit, threads: [entry(params.session ?? "")], agentLabels: { main: "Main agent" }, truncated: false } satisfies ThreadsTimeline } as const),
    ),
    clearCache: vi.fn(),
  };
  return { service: createThreadFamilyService(bb, { tokenUsage, threadsTimeline }), tokenUsage, threadsTimeline, harness };
}

const ask = { threadId: "root", unit: 60, groupWorkflows: true };

describe("createThreadFamilyService", () => {
  it("answers with no members for a thread that started nothing, without counting anything", async () => {
    const { service, tokenUsage, threadsTimeline } = setup({ threads: [row("root", null), row("other", null)], sessions: { root: "s-root" }, usage: { "s-root": [10, 1] } });

    expect(await service.query(ask)).toEqual({ members: [], total: sumTotals([]), truncated: false, unreadable: 0 });
    expect(tokenUsage.query).not.toHaveBeenCalled();
    expect(threadsTimeline.query).not.toHaveBeenCalled();
  });

  it("lists hidden threads too — a workflow's agent threads are children like any other", async () => {
    const { service, harness } = setup({ threads: [row("root", null)] });

    await service.query(ask);

    expect(harness.sdk.callsTo("threads.list")[0]?.[0]).toMatchObject({ includeHidden: true });
  });

  it("gives the thread first, then its descendants, each with its own session, usage and chart", async () => {
    const { service, threadsTimeline } = setup({
      threads: [row("grand", "child", "Grandchild"), row("child", "root", "Child"), row("root", null, "Parent")],
      sessions: { root: "s-root", child: "s-child", grand: "s-grand" },
      usage: { "s-root": [100, 4], "s-child": [50, 2.5], "s-grand": [25, 1.25] },
    });

    const result = await service.query(ask);

    expect(result.members.map((m) => [m.threadId, m.title, m.sessionId, m.totals.total, m.totals.cost])).toEqual([
      ["root", "Parent", "s-root", 100, 4],
      ["child", "Child", "s-child", 50, 2.5],
      ["grand", "Grandchild", "s-grand", 25, 1.25],
    ]);
    expect(result.members.map((m) => m.chart?.thread.session)).toEqual(["s-root", "s-child", "s-grand"]);
    expect(threadsTimeline.query).toHaveBeenCalledWith({ unit: 60, limit: 1, session: "s-child", groupWorkflows: true }, { fresh: undefined });
  });

  it("totals the whole family: the sum of its threads' usage and cost", async () => {
    const { service } = setup({
      threads: [row("root", null), row("a", "root"), row("b", "root")],
      sessions: { root: "s0", a: "s1", b: "s2" },
      usage: { s0: [100, 4], s1: [50, 2.5], s2: [25, 1.25] },
    });

    const result = await service.query(ask);

    expect(result.total).toMatchObject({ total: 175, cost: 7.75, messages: 3 });
  });

  it("leaves out a thread that has not started a session yet", async () => {
    const { service } = setup({ threads: [row("root", null), row("a", "root"), row("b", "root")], sessions: { root: "s0", b: "s2" }, usage: { s0: [10, 1], s2: [5, 0.5] } });

    const result = await service.query(ask);

    expect(result.members.map((m) => m.threadId)).toEqual(["root", "b"]);
    expect(result.unreadable).toBe(0);
  });

  it("counts a thread whose usage could not be read as unreadable and keeps the others", async () => {
    const { service } = setup({ threads: [row("root", null), row("a", "root"), row("b", "root")], sessions: { root: "s0", a: "s1", b: "s2" }, usage: { s0: [10, 1], s2: [5, 0.5] } });

    const result = await service.query(ask);

    expect(result.members.map((m) => m.threadId)).toEqual(["root", "b"]);
    expect(result.unreadable).toBe(1);
    expect(result.total.total).toBe(15);
  });

  it("keeps a thread's usage in the total when only its chart failed", async () => {
    const { service } = setup({ threads: [row("root", null), row("a", "root")], sessions: { root: "s0", a: "s1" }, usage: { s0: [10, 1], s1: [5, 0.5] }, chartFails: ["s1"] });

    const result = await service.query(ask);

    expect(result.members.map((m) => [m.threadId, m.chart])).toEqual([["root", expect.anything()], ["a", null]]);
    expect(result.total.total).toBe(15);
  });

  it("stops at the family size limit and says so", async () => {
    const children = Array.from({ length: MAX_FAMILY_MEMBERS + 5 }, (_, i) => row(`c${i}`, "root"));
    const sessions = Object.fromEntries([["root", "s-root"], ...children.map((c) => [c.id, `s-${c.id}`])]);
    const usage = Object.fromEntries(Object.values(sessions).map((s) => [s, [1, 0.01] as [number, number]]));
    const { service } = setup({ threads: [row("root", null), ...children], sessions, usage });

    const result = await service.query(ask);

    expect(result.members).toHaveLength(MAX_FAMILY_MEMBERS);
    expect(result.truncated).toBe(true);
  });

  it("passes a user's refresh on to the counting", async () => {
    const { service, tokenUsage } = setup({ threads: [row("root", null), row("a", "root")], sessions: { root: "s0", a: "s1" }, usage: { s0: [1, 0], s1: [1, 0] } });

    await service.query(ask, { fresh: true });

    expect(tokenUsage.query).toHaveBeenCalledWith(expect.objectContaining({ session: "s0" }), { fresh: true });
  });
});
