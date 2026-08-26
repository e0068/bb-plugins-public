import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  DEFAULT_VIZ_SETTINGS,
  VIZ_SETTINGS_KV_KEY,
  type AgentTimeline,
  type ThreadsTimeline,
  type TokensBucket,
  type TokensReport,
  type VizSettings,
} from "../src/core";
import type {
  AgentTimelineRunResult,
  AgentTimelineService,
  ThreadsTimelineRunResult,
  ThreadsTimelineService,
  TokenUsageService,
  TokensQueryParams,
  TokensRunResult,
} from "../src/service";
import plugin, { type PluginDeps } from "../server";

function fakeService(overrides: Partial<TokenUsageService> = {}): TokenUsageService {
  return {
    query: vi.fn(async (): Promise<TokensRunResult> => ({ ok: true, data: emptyReport() })),
    resolveSessionId: vi.fn(async () => null),
    clearCache: vi.fn(),
    ...overrides,
  };
}

function fakeAgentTimelineService(overrides: Partial<AgentTimelineService> = {}): AgentTimelineService {
  return {
    query: vi.fn(async (): Promise<AgentTimelineRunResult> => ({ ok: true, data: emptyAgentTimeline() })),
    clearCache: vi.fn(),
    ...overrides,
  };
}

function fakeThreadsTimelineService(overrides: Partial<ThreadsTimelineService> = {}): ThreadsTimelineService {
  return {
    query: vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: true, data: emptyThreadsTimeline() })),
    clearCache: vi.fn(),
    ...overrides,
  };
}

function emptyAgentTimeline(): AgentTimeline {
  return {
    schemaVersion: 2,
    agent: {
      key: "main",
      agentType: null,
      description: null,
      model: null,
      spawnDepth: null,
      promptExcerpt: null,
    },
    events: [],
  };
}

function emptyThreadsTimeline(): ThreadsTimeline {
  return { schemaVersion: 1, unit: 60, threads: [], agentLabels: {} };
}

const EMPTY_COSTS = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };

function emptyReport(): TokensReport {
  return {
    by: "agent",
    buckets: [],
    totals: {
      total: 0,
      input: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      output: 0,
      thinking: 0,
      messages: 0,
      cost: 0,
      costs: EMPTY_COSTS,
      models: [],
      buckets: 0,
    },
    truncated: false,
  };
}

function makeBucket(overrides: Partial<TokensBucket>): TokensBucket {
  return {
    key: "bucket",
    sessionId: "sess-1",
    project: "my-project",
    agent: null,
    total: 0,
    input: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
    messages: 0,
    cost: 0,
    models: [],
    firstAt: null,
    lastAt: null,
    ...overrides,
  };
}

async function loadPlugin(service: TokenUsageService) {
  const { bb, harness } = createFakePluginHost();
  await plugin(bb, { service });
  return harness;
}

async function loadPluginWithDeps(deps: PluginDeps) {
  const { bb, harness } = createFakePluginHost();
  await plugin(bb, deps);
  return harness;
}

/** Same as loadPluginWithDeps, but also hands back `bb` — needed by the
 * viz-settings tests below to poke `bb.storage.kv` directly (seed garbage,
 * inspect what got written) around the RPC calls. */
async function loadPluginFull(deps: PluginDeps = {}) {
  const { bb, harness } = createFakePluginHost();
  await plugin(bb, deps);
  return { bb, harness };
}

function validVizSettings(overrides: Partial<VizSettings["threads"]> = {}): VizSettings {
  return {
    ...DEFAULT_VIZ_SETTINGS,
    threads: { ...DEFAULT_VIZ_SETTINGS.threads, ...overrides },
  };
}

describe("server.ts sessionTokenUsage", () => {
  it("returns no-session when the thread has no resolved session yet", async () => {
    const service = fakeService({ resolveSessionId: vi.fn(async () => null) });
    const harness = await loadPlugin(service);

    const result = await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" });

    expect(result).toEqual({ status: "no-session" });
  });

  it("returns error with the backend's message when the query fails", async () => {
    const service = fakeService({
      resolveSessionId: vi.fn(async () => "sess-1"),
      query: vi.fn(
        async (): Promise<TokensRunResult> => ({
          ok: false,
          reason: "python_not_found",
          message: "Не найден интерпретатор Python (python3 или python) в PATH.",
        }),
      ),
    });
    const harness = await loadPlugin(service);

    const result = await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" });

    expect(result).toEqual({
      status: "error",
      message: "Не найден интерпретатор Python (python3 или python) в PATH.",
    });
  });

  // Regression coverage for the bug this fix addresses: when tools/tokens.py
  // fails to produce any stdout (missing file, crash before it can print its
  // own {"error": ...} envelope), the service layer now folds stderr/exit
  // code into the message (see src/service/__tests__/tokens-runner.test.ts).
  // This confirms that enriched message reaches the RPC response unchanged.
  it("passes through an invalid_output message enriched with stderr diagnostics", async () => {
    const service = fakeService({
      resolveSessionId: vi.fn(async () => "sess-1"),
      query: vi.fn(
        async (): Promise<TokensRunResult> => ({
          ok: false,
          reason: "invalid_output",
          message:
            "empty output (код завершения 2): python3: can't open file 'tools/tokens.py': [Errno 2] No such file or directory",
        }),
      ),
    });
    const harness = await loadPlugin(service);

    const result = await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" });

    expect(result).toEqual({
      status: "error",
      message:
        "empty output (код завершения 2): python3: can't open file 'tools/tokens.py': [Errno 2] No such file or directory",
    });
  });

  it("returns error instead of letting a thrown SDK exception surface as a raw transport failure", async () => {
    // resolveSessionId (and threads.events.list underneath it in the real
    // service) can reject — a deleted thread, the daemon being unreachable.
    // Without a catch here, that exception escapes the rpc handler and the
    // host turns it into an opaque 500, instead of the app's handled
    // "error" status with readable text.
    const service = fakeService({
      resolveSessionId: vi.fn(async () => {
        throw new Error("демон недоступен");
      }),
    });
    const harness = await loadPlugin(service);

    const result = await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" });

    expect(result).toEqual({ status: "error", message: "демон недоступен" });
  });

  it("returns error when the query itself throws, not just when it resolves to ok:false", async () => {
    const service = fakeService({
      resolveSessionId: vi.fn(async () => "sess-1"),
      query: vi.fn(async () => {
        throw new Error("query blew up");
      }),
    });
    const harness = await loadPlugin(service);

    const result = await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" });

    expect(result).toEqual({ status: "error", message: "query blew up" });
  });

  it("passes an explicit --top instead of relying on tokens.py's own 25-row default, and surfaces truncation", async () => {
    const query = vi.fn(
      async (_params: TokensQueryParams): Promise<TokensRunResult> => ({
        ok: true,
        data: { ...emptyReport(), truncated: true },
      }),
    );
    const service = fakeService({ resolveSessionId: vi.fn(async () => "sess-1"), query });
    const harness = await loadPlugin(service);

    const result = await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" });

    expect(query).toHaveBeenCalledTimes(1);
    const [params] = query.mock.calls[0];
    expect(params.by).toBe("agent");
    expect(params.session).toBe("sess-1");
    // Must be an explicit cap well above tokens.py's own default of 25, or a
    // 40-subagent session silently loses rows with no signal to the UI.
    expect(params.top).toBeGreaterThan(25);
    expect(result).toMatchObject({ status: "ready", truncated: true });
  });

  it("preserves the order buckets already arrive in from tokens.py instead of re-sorting them", async () => {
    // tokens.py sorts its rows by descending total before truncating to
    // --top; a client-side re-sort is redundant work that can only ever
    // match what's already there. Feed buckets in an order that is NOT
    // descending by total to prove the server trusts that order rather
    // than imposing its own.
    const report: TokensReport = {
      ...emptyReport(),
      buckets: [
        makeBucket({ key: "agent-a", total: 100, cost: 0.01 }),
        makeBucket({ key: "main", total: 900, cost: 0.2 }),
      ],
    };
    const service = fakeService({
      resolveSessionId: vi.fn(async () => "sess-1"),
      query: vi.fn(async (): Promise<TokensRunResult> => ({ ok: true, data: report })),
    });
    const harness = await loadPlugin(service);

    const result = (await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" })) as {
      status: string;
      agents: { key: string }[];
    };

    expect(result.agents.map((a) => a.key)).toEqual(["agent-a", "main"]);
  });

  it("rejects an output that doesn't conform to the strict schema instead of returning malformed JSON", async () => {
    // A non-finite total (NaN/Infinity) must never reach the wire — the
    // rpc output schema (finiteNumber = z.number().finite()) is what's
    // supposed to catch that. Prove the host's schema validation actually
    // enforces it end to end, not just that the TS types look right.
    const report: TokensReport = {
      ...emptyReport(),
      totals: { ...emptyReport().totals, total: NaN },
    };
    const service = fakeService({
      resolveSessionId: vi.fn(async () => "sess-1"),
      query: vi.fn(async (): Promise<TokensRunResult> => ({ ok: true, data: report })),
    });
    const harness = await loadPlugin(service);

    await expect(harness.callRpc("sessionTokenUsage", { threadId: "thread-1" })).rejects.toThrow();
  });

  it("rejects an output whose costs breakdown has a non-finite value", async () => {
    const report: TokensReport = {
      ...emptyReport(),
      totals: { ...emptyReport().totals, costs: { ...EMPTY_COSTS, cacheRead: Infinity } },
    };
    const service = fakeService({
      resolveSessionId: vi.fn(async () => "sess-1"),
      query: vi.fn(async (): Promise<TokensRunResult> => ({ ok: true, data: report })),
    });
    const harness = await loadPlugin(service);

    await expect(harness.callRpc("sessionTokenUsage", { threadId: "thread-1" })).rejects.toThrow();
  });

  it("maps report totals (including the per-kind cost breakdown) and per-agent rows to the RPC output shape", async () => {
    const report: TokensReport = {
      by: "agent",
      buckets: [
        {
          key: "agent-a9e92d5bea00f5cb7",
          sessionId: "sess-1",
          project: "my-project",
          agent: {
            id: "a9e92d5bea00f5cb7",
            description: "H4: тесты",
            agentType: "general-purpose",
            model: "sonnet",
            workflowRunId: null,
          },
          total: 500,
          input: 100,
          cacheWrite5m: 50,
          cacheWrite1h: 0,
          cacheRead: 200,
          output: 140,
          thinking: 10,
          messages: 3,
          cost: 0.12,
          models: [{ tier: "sonnet", total: 100 }],
          firstAt: null,
          lastAt: null,
        },
        {
          key: "main",
          sessionId: "sess-1",
          project: "my-project",
          agent: null,
          total: 1500,
          input: 300,
          cacheWrite5m: 100,
          cacheWrite1h: 50,
          cacheRead: 900,
          output: 140,
          thinking: 10,
          messages: 7,
          cost: 0.4,
          models: [{ tier: "sonnet", total: 100 }],
          firstAt: null,
          lastAt: null,
        },
      ],
      totals: {
        total: 2000,
        input: 400,
        cacheWrite5m: 150,
        cacheWrite1h: 50,
        cacheRead: 1100,
        output: 280,
        thinking: 20,
        messages: 10,
        cost: 0.52,
        costs: { input: 0.01, cacheWrite: 0.1, cacheRead: 0.3, output: 0.1, thinking: 0.01 },
        models: [{ tier: "sonnet", total: 100 }],
        buckets: 2,
      },
      truncated: false,
    };
    const query = vi.fn(async (_params: TokensQueryParams): Promise<TokensRunResult> => ({ ok: true, data: report }));
    const service = fakeService({
      resolveSessionId: vi.fn(async () => "sess-1"),
      query,
    });
    const harness = await loadPlugin(service);

    const result = await harness.callRpc("sessionTokenUsage", { threadId: "thread-1" });

    expect(result).toEqual({
      status: "ready",
      sessionId: "sess-1",
      truncated: false,
      totals: {
        total: 2000,
        input: 400,
        cacheWrite: 200,
        cacheRead: 1100,
        output: 280,
        thinking: 20,
        cost: 0.52,
        costs: { input: 0.01, cacheWrite: 0.1, cacheRead: 0.3, output: 0.1, thinking: 0.01 },
        messages: 10,
      },
      agents: [
        {
          key: "agent-a9e92d5bea00f5cb7",
          name: "H4: тесты",
          caption: "general-purpose · sonnet 100",
          total: 500,
          cost: 0.12,
        },
        {
          key: "main",
          name: "Главный агент",
          caption: "sonnet 100",
          total: 1500,
          cost: 0.4,
        },
      ],
    });
    const [params] = query.mock.calls[0];
    expect(params).toMatchObject({ by: "agent", session: "sess-1" });
  });
});

describe("server.ts agentTimeline", () => {
  it("rejects an empty session", async () => {
    const harness = await loadPluginWithDeps({});

    await expect(harness.callRpc("agentTimeline", { session: "", agent: "main" })).rejects.toThrow();
  });

  it("rejects an empty agent", async () => {
    const harness = await loadPluginWithDeps({});

    await expect(harness.callRpc("agentTimeline", { session: "sess-1", agent: "" })).rejects.toThrow();
  });

  it("rejects an unknown extra key (strict input schema)", async () => {
    const harness = await loadPluginWithDeps({});

    await expect(
      harness.callRpc("agentTimeline", { session: "sess-1", agent: "main", threadId: "thread-1" }),
    ).rejects.toThrow();
  });

  it("queries both the session totals and the agent timeline directly with (session, agent) — no threadId resolution", async () => {
    const query = vi.fn(async (): Promise<TokensRunResult> => ({ ok: true, data: emptyReport() }));
    const service = fakeService({ query });
    const timelineQuery = vi.fn(async (): Promise<AgentTimelineRunResult> => ({ ok: true, data: emptyAgentTimeline() }));
    const agentTimelineService = fakeAgentTimelineService({ query: timelineQuery });
    const harness = await loadPluginWithDeps({ service, agentTimelineService });

    await harness.callRpc("agentTimeline", { session: "sess-1", agent: "agent-abc" });

    expect(service.resolveSessionId).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith({ by: "agent", session: "sess-1", top: expect.any(Number) });
    expect(timelineQuery).toHaveBeenCalledWith({ session: "sess-1", agent: "agent-abc" });
  });

  it("maps a ready timeline (agent info + events) plus session totals/agents to the RPC output shape", async () => {
    const timeline: AgentTimeline = {
      schemaVersion: 2,
      agent: {
        key: "agent-abc",
        agentType: "general-purpose",
        description: "H4: тесты",
        model: "sonnet",
        spawnDepth: 1,
        promptExcerpt: "запусти тесты",
      },
      events: [
        { ts: "2026-08-25T10:00:00Z", kind: "tool", name: "Read", target: "server.ts" },
        { ts: "2026-08-25T10:00:01Z", kind: "hook", hookName: "pre-tool", hookEvent: "PreToolUse" },
        { ts: "2026-08-25T10:00:02Z", kind: "message", role: "assistant", text: "готово", tokens: 120, cost: 0.03 },
      ],
    };
    const report: TokensReport = {
      ...emptyReport(),
      buckets: [makeBucket({ key: "main", total: 900, cost: 0.2 })],
      totals: { ...emptyReport().totals, total: 900, cost: 0.2 },
    };
    const service = fakeService({ query: vi.fn(async (): Promise<TokensRunResult> => ({ ok: true, data: report })) });
    const agentTimelineService = fakeAgentTimelineService({
      query: vi.fn(async (): Promise<AgentTimelineRunResult> => ({ ok: true, data: timeline })),
    });
    const harness = await loadPluginWithDeps({ service, agentTimelineService });

    const result = await harness.callRpc("agentTimeline", { session: "sess-1", agent: "agent-abc" });

    expect(result).toMatchObject({
      status: "ready",
      agent: timeline.agent,
      events: timeline.events,
      totals: { total: 900, cost: 0.2 },
      agents: [{ key: "main", total: 900, cost: 0.2 }],
    });
  });

  it("returns error with the backend's message when the totals query fails", async () => {
    const service = fakeService({
      query: vi.fn(
        async (): Promise<TokensRunResult> => ({ ok: false, reason: "python_not_found", message: "нет python" }),
      ),
    });
    const agentTimelineService = fakeAgentTimelineService();
    const harness = await loadPluginWithDeps({ service, agentTimelineService });

    const result = await harness.callRpc("agentTimeline", { session: "sess-1", agent: "main" });

    expect(result).toEqual({ status: "error", message: "нет python" });
  });

  it("returns error with the backend's message when the timeline query fails", async () => {
    const service = fakeService();
    const agentTimelineService = fakeAgentTimelineService({
      query: vi.fn(async (): Promise<AgentTimelineRunResult> => ({ ok: false, reason: "invalid_output", message: "плохой вывод" })),
    });
    const harness = await loadPluginWithDeps({ service, agentTimelineService });

    const result = await harness.callRpc("agentTimeline", { session: "sess-1", agent: "main" });

    expect(result).toEqual({ status: "error", message: "плохой вывод" });
  });

  it("returns error instead of letting a thrown exception surface as a raw transport failure", async () => {
    const service = fakeService();
    const agentTimelineService = fakeAgentTimelineService({
      query: vi.fn(async () => {
        throw new Error("демон недоступен");
      }),
    });
    const harness = await loadPluginWithDeps({ service, agentTimelineService });

    const result = await harness.callRpc("agentTimeline", { session: "sess-1", agent: "main" });

    expect(result).toEqual({ status: "error", message: "демон недоступен" });
  });

  it("rejects an output that doesn't conform to the strict schema", async () => {
    // A bogus event kind must never reach the wire — proves the RPC output
    // schema actually reuses (and enforces) agentTimelineEventSchema from
    // src/core, not a loosened local copy.
    const timeline = {
      ...emptyAgentTimeline(),
      events: [{ ts: "2026-08-25T10:00:00Z", kind: "bogus", name: "x" }],
    } as unknown as AgentTimeline;
    const service = fakeService();
    const agentTimelineService = fakeAgentTimelineService({
      query: vi.fn(async (): Promise<AgentTimelineRunResult> => ({ ok: true, data: timeline })),
    });
    const harness = await loadPluginWithDeps({ service, agentTimelineService });

    await expect(harness.callRpc("agentTimeline", { session: "sess-1", agent: "main" })).rejects.toThrow();
  });
});

describe("server.ts threadsTimeline", () => {
  it("accepts a valid input", async () => {
    const threadsTimelineService = fakeThreadsTimelineService();
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    const result = await harness.callRpc("threadsTimeline", { limit: 20, unit: 60 });

    expect(result).toEqual({ status: "ready", unit: 60, threads: [], agentLabels: {} });
  });

  it("rejects limit=0 (below the minimum)", async () => {
    const harness = await loadPluginWithDeps({});

    await expect(harness.callRpc("threadsTimeline", { limit: 0, unit: 60 })).rejects.toThrow();
  });

  it("rejects limit=1000 (above the maximum)", async () => {
    const harness = await loadPluginWithDeps({});

    await expect(harness.callRpc("threadsTimeline", { limit: 1000, unit: 60 })).rejects.toThrow();
  });

  it("rejects a non-positive unit", async () => {
    const harness = await loadPluginWithDeps({});

    await expect(harness.callRpc("threadsTimeline", { limit: 20, unit: 0 })).rejects.toThrow();
  });

  it("rejects an unknown extra key (strict input schema)", async () => {
    const harness = await loadPluginWithDeps({});

    await expect(
      harness.callRpc("threadsTimeline", { limit: 20, unit: 60, bogus: "x" }),
    ).rejects.toThrow();
  });

  it("passes params straight through to the threads timeline service", async () => {
    const query = vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: true, data: emptyThreadsTimeline() }));
    const threadsTimelineService = fakeThreadsTimelineService({ query });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    await harness.callRpc("threadsTimeline", { limit: 20, unit: 60, project: "my-project" });

    expect(query).toHaveBeenCalledWith({ limit: 20, unit: 60, project: "my-project" });
  });

  it("maps a ready slice (unit + threads) to the RPC output shape", async () => {
    const timeline: ThreadsTimeline = {
      schemaVersion: 1,
      unit: 60,
      threads: [
        {
          session: "sess-1",
          project: "my-project",
          title: "sess-1",
          start: "2026-08-25T10:00:00Z",
          end: "2026-08-25T10:05:00Z",
          durationSec: 300,
          totalTokens: 1500,
          totalCost: 0.75,
          workflowCount: 3,
          bins: [{ t: "2026-08-25T10:00:00Z", agents: [{ key: "main", total: 1500 }] }],
          bbProjectId: "proj-1",
          bbProjectName: "bb-plugins",
          threadId: "thread-1",
          bbThreadTitle: "Тред 1",
        },
      ],
      agentLabels: { main: "Главный агент" },
    };
    const threadsTimelineService = fakeThreadsTimelineService({
      query: vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: true, data: timeline })),
    });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    const result = await harness.callRpc("threadsTimeline", { limit: 20, unit: 60 });

    expect(result).toEqual({
      status: "ready",
      unit: timeline.unit,
      threads: timeline.threads,
      agentLabels: timeline.agentLabels,
    });
  });

  it("returns error with the backend's message when the query fails", async () => {
    const threadsTimelineService = fakeThreadsTimelineService({
      query: vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: false, reason: "invalid_params", message: "плохой unit" })),
    });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    const result = await harness.callRpc("threadsTimeline", { limit: 20, unit: 60 });

    expect(result).toEqual({ status: "error", message: "плохой unit" });
  });

  it("returns error instead of letting a thrown exception surface as a raw transport failure", async () => {
    const threadsTimelineService = fakeThreadsTimelineService({
      query: vi.fn(async () => {
        throw new Error("демон недоступен");
      }),
    });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    const result = await harness.callRpc("threadsTimeline", { limit: 20, unit: 60 });

    expect(result).toEqual({ status: "error", message: "демон недоступен" });
  });

  it("rejects an output that doesn't conform to the strict schema", async () => {
    // A non-finite totalTokens must never reach the wire — proves the RPC
    // output schema's finiteNumber actually validates thread entries end to
    // end, not just that the TS types look right.
    const timeline: ThreadsTimeline = {
      schemaVersion: 1,
      unit: 60,
      threads: [
        {
          session: "sess-1",
          project: "my-project",
          title: "sess-1",
          start: "2026-08-25T10:00:00Z",
          end: "2026-08-25T10:05:00Z",
          durationSec: 300,
          totalTokens: NaN,
          bins: [],
          bbProjectId: null,
          bbProjectName: null,
          threadId: null,
          bbThreadTitle: null,
        },
      ],
      agentLabels: {},
    };
    const threadsTimelineService = fakeThreadsTimelineService({
      query: vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: true, data: timeline })),
    });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    await expect(harness.callRpc("threadsTimeline", { limit: 20, unit: 60 })).rejects.toThrow();
  });

  it("rejects a thread entry missing bbProjectId/bbProjectName/threadId (strict output schema)", async () => {
    // Proves the RPC output schema actually requires the new BB-project
    // match fields end to end, not just that ThreadEntry's TS type has them.
    const badThread = {
      session: "sess-1",
      project: "my-project",
      title: "sess-1",
      start: "2026-08-25T10:00:00Z",
      end: "2026-08-25T10:05:00Z",
      durationSec: 300,
      totalTokens: 1500,
      bins: [],
    };
    const timeline = { schemaVersion: 1, unit: 60, threads: [badThread], agentLabels: {} } as unknown as ThreadsTimeline;
    const threadsTimelineService = fakeThreadsTimelineService({
      query: vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: true, data: timeline })),
    });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    await expect(harness.callRpc("threadsTimeline", { limit: 20, unit: 60 })).rejects.toThrow();
  });

  it("rejects an agentLabels value that isn't a string (strict output schema)", async () => {
    // Proves the RPC output schema actually enforces agentLabels' Record<string,
    // string> shape end to end, not just that ThreadsTimeline's TS type has it.
    const timeline = {
      schemaVersion: 1,
      unit: 60,
      threads: [],
      agentLabels: { main: 42 },
    } as unknown as ThreadsTimeline;
    const threadsTimelineService = fakeThreadsTimelineService({
      query: vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: true, data: timeline })),
    });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    await expect(harness.callRpc("threadsTimeline", { limit: 20, unit: 60 })).rejects.toThrow();
  });

  it("passes agentLabels through to the RPC output as-is", async () => {
    const timeline: ThreadsTimeline = {
      schemaVersion: 1,
      unit: 60,
      threads: [],
      agentLabels: { main: "Главный агент", "agent-abc": "Ревью PR" },
    };
    const threadsTimelineService = fakeThreadsTimelineService({
      query: vi.fn(async (): Promise<ThreadsTimelineRunResult> => ({ ok: true, data: timeline })),
    });
    const harness = await loadPluginWithDeps({ threadsTimelineService });

    const result = await harness.callRpc("threadsTimeline", { limit: 20, unit: 60 });

    expect(result).toMatchObject({ agentLabels: { main: "Главный агент", "agent-abc": "Ревью PR" } });
  });
});

describe("server.ts loadVizSettings / saveVizSettings", () => {
  it("returns full defaults when kv has never been written", async () => {
    const { harness } = await loadPluginFull();

    const result = await harness.callRpc("loadVizSettings", {});

    expect(result).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("round-trips a saved value through the fake host's own bb.storage.kv (no deps.kv override)", async () => {
    const { harness } = await loadPluginFull();
    const toSave = validVizSettings({ unit: 900, sortMode: "tokens", agentColors: { main: "#3b82f6" } });

    const saveResult = await harness.callRpc("saveVizSettings", toSave);
    expect(saveResult).toEqual({ ok: true });

    const loaded = await harness.callRpc("loadVizSettings", {});
    expect(loaded).toEqual(toSave);
  });

  it("persists straight to bb.storage.kv under the shared key, readable independently of the RPC layer", async () => {
    const { bb, harness } = await loadPluginFull();
    const toSave = validVizSettings({ heightScale: 2 });

    await harness.callRpc("saveVizSettings", toSave);

    await expect(bb.storage.kv.get(VIZ_SETTINGS_KV_KEY)).resolves.toEqual(toSave);
  });

  it("does not throw and falls back to defaults when kv holds unrelated garbage", async () => {
    const { bb, harness } = await loadPluginFull();
    await bb.storage.kv.set(VIZ_SETTINGS_KV_KEY, { totally: "unrelated", nested: [1, 2, 3] });

    const result = await harness.callRpc("loadVizSettings", {});

    expect(result).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("does not throw and falls back to defaults when kv holds a scalar instead of an object", async () => {
    const { bb, harness } = await loadPluginFull();
    await bb.storage.kv.set(VIZ_SETTINGS_KV_KEY, "not an object");

    const result = await harness.callRpc("loadVizSettings", {});

    expect(result).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("rejects saveVizSettings when a known field is out of its allowed range", async () => {
    const { harness } = await loadPluginFull();

    await expect(
      harness.callRpc("saveVizSettings", validVizSettings({ heightScale: 999 })),
    ).rejects.toThrow();
  });

  it("rejects saveVizSettings when a known field has the wrong type", async () => {
    const { harness } = await loadPluginFull();
    const bad = { ...validVizSettings(), threads: { ...DEFAULT_VIZ_SETTINGS.threads, unit: "sixty" } };

    await expect(harness.callRpc("saveVizSettings", bad)).rejects.toThrow();
  });

  it("rejects saveVizSettings when an unknown top-level key is present (strict input schema)", async () => {
    const { harness } = await loadPluginFull();
    const bad = { ...validVizSettings(), bogus: true };

    await expect(harness.callRpc("saveVizSettings", bad)).rejects.toThrow();
  });

  it("rejects saveVizSettings when an unknown nested key is present", async () => {
    const { harness } = await loadPluginFull();
    const bad = { ...validVizSettings(), threads: { ...DEFAULT_VIZ_SETTINGS.threads, bogus: "x" } };

    await expect(harness.callRpc("saveVizSettings", bad)).rejects.toThrow();
  });

  it("rejects saveVizSettings when agentColors holds a non-hex value", async () => {
    const { harness } = await loadPluginFull();
    const bad = validVizSettings({ agentColors: { main: "not-a-color" } });

    await expect(harness.callRpc("saveVizSettings", bad)).rejects.toThrow();
  });

  it("does not write to kv when the input is rejected by the schema", async () => {
    const { bb, harness } = await loadPluginFull();
    const bad = { ...validVizSettings(), bogus: true };

    await expect(harness.callRpc("saveVizSettings", bad)).rejects.toThrow();

    await expect(bb.storage.kv.get(VIZ_SETTINGS_KV_KEY)).resolves.toBeUndefined();
  });

  it("uses deps.kv instead of bb.storage.kv when provided, for isolating a stubbed failure", async () => {
    const rejectingKv = {
      get: vi.fn(async () => {
        throw new Error("kv unreachable");
      }),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    };
    const { harness } = await loadPluginFull({ kv: rejectingKv });

    // load must not let the rejection escape — same "no opaque transport
    // failure" contract as the other RPC methods in this file.
    const result = await harness.callRpc("loadVizSettings", {});

    expect(result).toEqual(DEFAULT_VIZ_SETTINGS);
    expect(rejectingKv.get).toHaveBeenCalledWith(VIZ_SETTINGS_KV_KEY);
  });

  it("propagates a save-time kv rejection as a normal RPC failure", async () => {
    const rejectingKv = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {
        throw new Error("kv unreachable");
      }),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    };
    const { harness } = await loadPluginFull({ kv: rejectingKv });

    await expect(harness.callRpc("saveVizSettings", validVizSettings())).rejects.toThrow("kv unreachable");
  });
});
