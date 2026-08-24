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
  it("именует бакет главного агента даже без объекта агента", () => {
    expect(formatBucketDisplay(makeBucket({ key: "main" }))).toEqual({
      name: "Главный агент",
      caption: null,
    });
  });

  it("у бакета с данными агента имя — описание запуска, подпись — тип и модели с расходом", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      models: [{ tier: "sonnet", total: 172_000 }],
      agent: { id: "abc", description: "H1: тест", agentType: "general-purpose", model: "sonnet", workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket)).toEqual({
      name: "H1: тест",
      caption: "general-purpose · sonnet 172.0k",
    });
  });

  it("подпись показывает тип и модели даже когда имя уже говорящее", () => {
    // Именно это отличает display от прежнего единого label: тип и модели не
    // прячутся, как только у агента есть описание запуска.
    const bucket = makeBucket({
      key: "agent-abc",
      models: [{ tier: "opus", total: 900 }],
      agent: { id: "abc", description: "Починка", agentType: "code-reviewer", model: "opus", workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).caption).toBe("code-reviewer · opus 900");
  });

  it("перечисляет все модели бакета с расходом, по убыванию", () => {
    // Живой случай, ради которого это и переделано: главный агент работал на
    // трёх моделях, а подпись показывала одну — и по алфавиту это оказывался
    // haiku, самая дешёвая из трёх.
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

  it("субагент с известным типом, но без единой модели — подпись без « · »", () => {
    // tier() в питоновской считалке всегда возвращает какой-то тир, поэтому
    // бакет главного агента с хотя бы одним сообщением не бывает без
    // models — но у subagent-бакета models может опустеть (например, вызов
    // не оставил ни одной записи о цене), и тогда join не должен оставлять
    // висячий " · " перед пустой правой частью.
    const bucket = makeBucket({
      key: "agent-abc",
      models: [],
      agent: { id: "abc", description: "Разбор PR", agentType: "code-reviewer", model: null, workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).caption).toBe("code-reviewer");
  });

  it("главный агент без единой модели остаётся без подписи", () => {
    expect(formatBucketDisplay(makeBucket({ key: "main", models: [] })).caption).toBeNull();
  });

  it("имя падает до типа агента, когда нет описания запуска", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      agent: { id: "abc", description: null, agentType: "general-purpose", model: null, workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).name).toBe("general-purpose");
  });

  it("имя падает до общего 'Субагент', когда нет ни описания, ни типа", () => {
    const bucket = makeBucket({
      key: "agent-abc",
      agent: { id: "abc", description: null, agentType: null, model: null, workflowRunId: null },
    });
    expect(formatBucketDisplay(bucket).name).toBe("Субагент");
  });

  it("ключ бакета идёт как есть для разрезов без агента (сессия, проект, модель, день, workflow)", () => {
    expect(formatBucketDisplay(makeBucket({ key: "my-project" }))).toEqual({
      name: "my-project",
      caption: null,
    });
    expect(formatBucketDisplay(makeBucket({ key: "2026-08-01" })).name).toBe("2026-08-01");
  });

  it("длинное имя усекается, подпись при этом остаётся целой", () => {
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
