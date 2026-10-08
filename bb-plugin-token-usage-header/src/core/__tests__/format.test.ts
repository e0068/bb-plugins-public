import { describe, expect, it } from "vitest";
import type { TokensBucket } from "../types";
import {
  cacheWriteTotal,
  formatBucketDisplay,
  formatClockTime,
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
    variants: [],
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

describe("formatClockTime", () => {
  it("formats as HH:MM", () => {
    // Not a fixed "HH:MM" string: toLocaleTimeString depends on the running
    // machine's timezone (same as thread-chart.tsx's own fmtClock, which
    // mirrors this shape) — only the format is this function's contract.
    expect(formatClockTime(Date.parse("2026-09-03T12:00:00.000Z"))).toMatch(/^\d{2}:\d{2}$/);
  });

  it("reads an unparseable ms value as an em dash instead of throwing", () => {
    expect(formatClockTime(NaN)).toBe("—");
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

  it("for a bucket with agent data, the name is the launch description and the caption is the type plus model, version and effort", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      models: [{ tier: "opus", total: 12_500_000 }],
      variants: [{ model: "claude-opus-4-8", effort: "high", fast: false, total: 12_500_000 }],
      agent: { id: "abc", description: "Write red tests", agentType: "general-purpose", model: "opus", workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket)).toEqual({
      name: "Write red tests",
      caption: "general-purpose · opus 4.8 · high",
    });
  });

  it("marks a fast-mode variant with ↯ after the effort", () => {
    const bucket = makeBucket({
      key: "main",
      variants: [{ model: "claude-opus-5-5", effort: "xhigh", fast: true, total: 10 }],
    });
    expect(formatBucketDisplay(bucket).caption).toBe("opus 5.5 · xhigh ↯");
  });

  it("a variant without effort (old transcripts) shows only the model with its version", () => {
    const bucket = makeBucket({
      key: "main",
      variants: [{ model: "claude-opus-4-7", effort: null, fast: false, total: 10 }],
    });
    expect(formatBucketDisplay(bucket).caption).toBe("opus 4.7");
  });

  it("lists every variant in the order the counter gives — by usage, largest first", () => {
    const bucket = makeBucket({
      key: "main",
      variants: [
        { model: "claude-opus-5-5", effort: "high", fast: true, total: 900 },
        { model: "claude-sonnet-5", effort: "medium", fast: false, total: 50 },
        { model: "claude-haiku-4-5-20251001", effort: null, fast: false, total: 7 },
      ],
    });
    expect(formatBucketDisplay(bucket).caption).toBe("opus 5.5 · high ↯, sonnet 5 · medium, haiku 4.5");
  });

  it("names model ids of every known shape by family and dotted version", () => {
    const caption = (model: string) =>
      formatBucketDisplay(makeBucket({ key: "main", variants: [{ model, effort: null, fast: false, total: 1 }] })).caption;
    expect(caption("claude-fable-5-1")).toBe("fable 5.1");
    expect(caption("claude-sonnet-4-20250514")).toBe("sonnet 4");
    expect(caption("claude-3-5-sonnet-20241022")).toBe("sonnet 3.5");
  });

  it("an unfamiliar model name is shown as is", () => {
    const bucket = makeBucket({ key: "main", variants: [{ model: "gpt-5-codex", effort: "high", fast: false, total: 1 }] });
    expect(formatBucketDisplay(bucket).caption).toBe("gpt-5-codex · high");
  });

  it("the caption carries no token counts — usage is shown once, next to the cost", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      models: [{ tier: "opus", total: 3_600_000 }],
      variants: [{ model: "claude-opus-4-8", effort: "high", fast: false, total: 3_600_000 }],
      agent: { id: "abc", description: "Review", agentType: "code-reviewer", model: "opus", workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).caption).not.toMatch(/\d(\.\d)?[kM]\b/);
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
