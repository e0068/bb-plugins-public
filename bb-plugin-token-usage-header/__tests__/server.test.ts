import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { TokensBucket, TokensReport } from "../src/core";
import type { TokenUsageService, TokensQueryParams, TokensRunResult } from "../src/service";
import plugin from "../server";

function fakeService(overrides: Partial<TokenUsageService> = {}): TokenUsageService {
  return {
    query: vi.fn(async (): Promise<TokensRunResult> => ({ ok: true, data: emptyReport() })),
    resolveSessionId: vi.fn(async () => null),
    clearCache: vi.fn(),
    ...overrides,
  };
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
