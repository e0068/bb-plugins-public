import { describe, expect, it } from "vitest";
import { EXPECTED_SCHEMA_VERSION } from "../types";
import { parseTokensOutput } from "../parse";

const validReport = {
  schemaVersion: EXPECTED_SCHEMA_VERSION,
  by: "agent",
  buckets: [
    {
      key: "agent-a9e92d5bea00f5cb7",
      sessionId: "71e96791-4523-42b7-8994-caa3330e5f9f",
      project: "-Users-e0068-Documents-Projects-bb-plugins",
      agent: {
        id: "a9e92d5bea00f5cb7",
        description: "H1: каркас плагина и JSON-режим",
        agentType: "general-purpose",
        model: "sonnet",
        workflowRunId: null,
      },
      total: 1397981,
      input: 44,
      cacheWrite5m: 75501,
      cacheWrite1h: 0,
      cacheRead: 1318261,
      output: 4175,
      thinking: 2486,
      messages: 22,
      cost: 0.74,
      models: [{ tier: "sonnet", total: 300 }],
      firstAt: "2026-08-20T14:40:33.943Z",
      lastAt: "2026-08-20T14:44:56.989Z",
    },
    {
      key: "main",
      sessionId: "71e96791-4523-42b7-8994-caa3330e5f9f",
      project: "-Users-e0068-Documents-Projects-bb-plugins",
      agent: null,
      total: 3411232,
      input: 54,
      cacheWrite5m: 0,
      cacheWrite1h: 177864,
      cacheRead: 3201266,
      output: 32048,
      thinking: 11212,
      messages: 27,
      cost: 4.18,
      models: [{ tier: "opus", total: 700 }],
      firstAt: "2026-08-20T13:44:51.138Z",
      lastAt: "2026-08-20T14:46:48.357Z",
    },
  ],
  totals: {
    total: 4809213,
    input: 98,
    cacheWrite5m: 75501,
    cacheWrite1h: 177864,
    cacheRead: 4519527,
    output: 36223,
    thinking: 13698,
    messages: 49,
    cost: 4.92,
    costs: { input: 0.01, cacheWrite: 1.2, cacheRead: 2.3, output: 1.4, thinking: 0.01 },
    models: [{ tier: "opus", total: 700 }, { tier: "sonnet", total: 300 }],
    buckets: 2,
  },
  truncated: false,
};

describe("parseTokensOutput", () => {
  it("parses a valid report with a bucket that has an agent", () => {
    const result = parseTokensOutput(JSON.stringify(validReport));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.by).toBe("agent");
    expect(result.data.buckets).toHaveLength(2);
    const agentBucket = result.data.buckets[0];
    expect(agentBucket.agent).not.toBeNull();
    expect(agentBucket.agent?.description).toBe("H1: каркас плагина и JSON-режим");
    expect(agentBucket.agent?.id).toBe("a9e92d5bea00f5cb7");
  });

  it("parses a bucket without an agent (main agent / aggregate cuts)", () => {
    const result = parseTokensOutput(JSON.stringify(validReport));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mainBucket = result.data.buckets[1];
    expect(mainBucket.agent).toBeNull();
    expect(mainBucket.key).toBe("main");
  });

  it("parses the totals block, including the per-kind cost breakdown", () => {
    const result = parseTokensOutput(JSON.stringify(validReport));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totals.buckets).toBe(2);
    expect(result.data.totals.cost).toBe(4.92);
    expect(result.data.totals.costs).toEqual({ input: 0.01, cacheWrite: 1.2, cacheRead: 2.3, output: 1.4, thinking: 0.01 });
  });

  it("rejects totals missing the costs breakdown", () => {
    const bad = { ...validReport, totals: { ...validReport.totals, costs: undefined } };
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("rejects totals whose costs breakdown is missing a field", () => {
    const { thinking: _drop, ...incompleteCosts } = validReport.totals.costs;
    const bad = { ...validReport, totals: { ...validReport.totals, costs: incompleteCosts } };
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("reports a script error object distinctly from a shape error", () => {
    const result = parseTokensOutput(JSON.stringify({ error: "python3 not found" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("script_error");
    expect(result.message).toBe("python3 not found");
  });

  it("rejects non-JSON garbage", () => {
    const result = parseTokensOutput("not json at all {{{");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });

  it("rejects empty output", () => {
    const result = parseTokensOutput("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
    expect(result.message).toBe("empty output");
  });

  it("rejects whitespace-only output", () => {
    const result = parseTokensOutput("   \n  ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });

  it("rejects JSON that isn't the right shape (array instead of object)", () => {
    const result = parseTokensOutput("[1, 2, 3]");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("rejects JSON missing required fields", () => {
    const result = parseTokensOutput(JSON.stringify({ schemaVersion: EXPECTED_SCHEMA_VERSION, by: "agent" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("rejects an invalid `by` value", () => {
    const bad = { ...validReport, by: "not-a-real-cut" };
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("rejects a bucket with a malformed agent object", () => {
    const bad = {
      ...validReport,
      buckets: [
        {
          ...validReport.buckets[0],
          agent: { id: 42 /* should be a string */ },
        },
      ],
    };
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("rejects a scalar JSON value", () => {
    const result = parseTokensOutput("42");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("accepts a report whose schemaVersion matches — parses as before", () => {
    const result = parseTokensOutput(JSON.stringify(validReport));
    expect(result.ok).toBe(true);
  });

  it("rejects a schemaVersion newer than this bundle expects, blaming a stale bundle", () => {
    // Версия на диске новее ожидаемой — отстала сборка бандла, лечится
    // пересборкой плагина.
    const bad = { ...validReport, schemaVersion: EXPECTED_SCHEMA_VERSION + 1 };
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
    expect(result.message).toContain("версию");
    expect(result.message).toContain("пересбор");
  });

  it("rejects a schemaVersion older than this bundle expects, blaming a stale tokens.py instead of the build", () => {
    // Версия на диске старше ожидаемой — устарел сам tools/tokens.py, а не
    // бандл; пересборка плагина тут не лечит, поэтому совет другой.
    const bad = { ...validReport, schemaVersion: EXPECTED_SCHEMA_VERSION - 1 };
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
    expect(result.message).toContain("версию");
    expect(result.message).not.toContain("Нужна пересборка");
    expect(result.message).toContain("не поможет");
  });

  it("rejects a report with no schemaVersion field (old counter), blaming a stale tokens.py", () => {
    const { schemaVersion: _drop, ...bad } = validReport;
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
    expect(result.message).toContain("версии");
    expect(result.message).toContain("отсутствует");
    expect(result.message).not.toContain("Нужна пересборка");
    expect(result.message).toContain("не поможет");
  });

  it("rejects a non-numeric schemaVersion, blaming a stale tokens.py (no numeric direction to compare)", () => {
    const bad = { ...validReport, schemaVersion: "1" };
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
    expect(result.message).toContain("версию");
    expect(result.message).not.toContain("Нужна пересборка");
    expect(result.message).toContain("не поможет");
  });

  it("checks schemaVersion before buckets/totals shape — a version mismatch wins over a shape error", () => {
    const bad = { schemaVersion: EXPECTED_SCHEMA_VERSION + 1, by: "agent" }; // buckets/totals missing entirely
    const result = parseTokensOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
  });

  it("does not let a version mismatch mask non-JSON input", () => {
    const result = parseTokensOutput("not json at all {{{");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });
});
