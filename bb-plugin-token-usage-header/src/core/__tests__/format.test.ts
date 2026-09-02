import { describe, expect, it } from "vitest";
import type { TokensBucket } from "../types";
import {
  cacheWriteTotal,
  formatBucketDisplay,
  formatCost,
  formatPercent,
  formatPercentValue,
  formatTokenCount,
} from "../format";

function makeBucket(overrides: Partial<TokensBucket> = {}): TokensBucket {
  return {
    key: "bucket",
    sessionId: null,
    project: null,
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

describe("formatTokenCount", () => {
  it("formats numbers just below the k threshold as plain integers", () => {
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats exactly 1000 as 1.0k", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
  });

  it("formats numbers just below the M threshold as k", () => {
    expect(formatTokenCount(999_999)).toBe("1000.0k");
  });

  it("formats exactly 1,000,000 as 1.0M", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
  });

  it("formats zero", () => {
    expect(formatTokenCount(0)).toBe("0");
  });

  it("does not throw on a negative value", () => {
    expect(() => formatTokenCount(-1234)).not.toThrow();
    expect(formatTokenCount(-1234)).toBe("-1.2k");
  });

  it("does not throw on non-finite input", () => {
    expect(() => formatTokenCount(NaN)).not.toThrow();
    expect(() => formatTokenCount(Infinity)).not.toThrow();
  });
});

describe("formatCost", () => {
  it("formats a typical dollar amount", () => {
    expect(formatCost(4.184)).toBe("$4.18");
  });

  it("formats zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });
});

describe("formatPercent", () => {
  it("computes a normal percentage", () => {
    expect(formatPercent(30, 120)).toBe("25%");
  });

  it("does not throw or divide-by-zero when whole is 0", () => {
    expect(() => formatPercent(30, 0)).not.toThrow();
    expect(formatPercent(30, 0)).toBe("0%");
  });

  it("does not throw when both part and whole are 0", () => {
    expect(formatPercent(0, 0)).toBe("0%");
  });
});

describe("formatPercentValue", () => {
  it("rounds an already-computed percentage", () => {
    expect(formatPercentValue(24.6)).toBe("25%");
  });

  it("does not throw on non-finite input", () => {
    expect(formatPercentValue(NaN)).toBe("0%");
    expect(formatPercentValue(Infinity)).toBe("0%");
  });
});

describe("formatBucketDisplay", () => {
  it("names the main agent's bucket even without an agent object", () => {
    expect(formatBucketDisplay(makeBucket({ key: "main" }))).toEqual({
      name: "Main agent",
      caption: null,
    });
  });

  it("for a bucket with agent data, the name is the launch description and the caption is the type plus models with usage", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      models: [{ tier: "sonnet", total: 172_000 }],
      agent: { id: "abc", description: "H1: test", agentType: "general-purpose", model: "sonnet", workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket)).toEqual({
      name: "H1: test",
      caption: "general-purpose · sonnet 172.0k",
    });
  });

  it("caption shows the type and models even when the name is already descriptive", () => {
    // This is exactly what distinguishes display from the former single
    // label: the type and models don't hide away just because the agent has
    // a launch description.
    const bucket = makeBucket({
      key: "agent-abc",
      models: [{ tier: "opus", total: 900 }],
      agent: { id: "abc", description: "Fix", agentType: "code-reviewer", model: "opus", workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).caption).toBe("code-reviewer · opus 900");
  });

  it("lists all of the bucket's models with usage, in descending order", () => {
    // The real case this was reworked for: the main agent worked across
    // three models, but the caption showed only one — and alphabetically
    // that turned out to be haiku, the cheapest of the three.
    const bucket = makeBucket({
      key: "main",
      models: [
        { tier: "opus", total: 5_660_729 },
        { tier: "sonnet", total: 52_037 },
        { tier: "haiku", total: 607 },
      ],
    });
    expect(formatBucketDisplay(bucket).caption).toBe("opus 5.7M, sonnet 52.0k, haiku 607");
  });

  it("subagent with a known type but no models at all — caption without the « · » separator", () => {
    // tier() in the Python counter script always returns some tier, so a
    // main-agent bucket with at least one message is never without models —
    // but a subagent bucket's models can be empty (e.g. the call left no
    // priced record at all), and then join must not leave a dangling " · "
    // in front of an empty right-hand side.
    const bucket = makeBucket({
      key: "agent-abc",
      models: [],
      agent: { id: "abc", description: "PR analysis", agentType: "code-reviewer", model: null, workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).caption).toBe("code-reviewer");
  });

  it("main agent with no models at all is left without a caption", () => {
    expect(formatBucketDisplay(makeBucket({ key: "main", models: [] })).caption).toBeNull();
  });

  it("name falls back to the agent type when there is no launch description", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      agent: { id: "abc", description: null, agentType: "general-purpose", model: null, workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).name).toBe("general-purpose");
  });

  it("name falls back to the generic 'Subagent' when there is neither a description nor a type", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      agent: { id: "abc", description: null, agentType: null, model: null, workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).name).toBe("Subagent");
  });

  it("the bucket key passes through as-is for agent-less cuts (session, project, model, day, workflow)", () => {
    expect(formatBucketDisplay(makeBucket({ key: "my-project" }))).toEqual({
      name: "my-project",
      caption: null,
    });
    expect(formatBucketDisplay(makeBucket({ key: "2026-08-01" })).name).toBe("2026-08-01");
  });

  it("a long name gets truncated while the caption stays intact", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      agent: {
        id: "abc",
        description: "A very long description that should get truncated for the UI column",
        agentType: "general-purpose",
        model: null,
        workflowRunId: null,
      },
    });
    const display = formatBucketDisplay(bucket, 20);
    expect(display.name.length).toBe(20);
    expect(display.name.endsWith("…")).toBe(true);
    expect(display.caption).toBe("general-purpose");
  });
});

describe("cacheWriteTotal", () => {
  it("sums the 5-minute and 1-hour cache-write buckets", () => {
    expect(cacheWriteTotal({ cacheWrite5m: 150, cacheWrite1h: 50 })).toBe(200);
  });

  it("handles both being zero", () => {
    expect(cacheWriteTotal({ cacheWrite5m: 0, cacheWrite1h: 0 })).toBe(0);
  });
});
