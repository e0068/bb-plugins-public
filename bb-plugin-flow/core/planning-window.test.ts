// @vitest-environment node
import { describe, expect, it } from "vitest";

import { windowCost } from "./planning";

const line = (id: string, timestamp: string, output: number) =>
  JSON.stringify({ type: "assistant", timestamp, requestId: id, message: { id, model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: output } } });

describe("стоимость окна времени", () => {
  it("считает только ответы с отметкой времени внутри окна", () => {
    const lines = [line("a", "2026-09-16T09:59:59.000Z", 1_000_000), line("b", "2026-09-16T10:00:00.000Z", 40_000), line("c", "2026-09-16T10:10:00.000Z", 40_000), line("d", "2026-09-16T10:20:00.000Z", 1_000_000)];
    expect(windowCost(lines, Date.parse("2026-09-16T10:00:00.000Z"), Date.parse("2026-09-16T10:20:00.000Z"))).toBe(2);
  });

  it("окно без ответов — стоимости нет", () => {
    expect(windowCost([line("a", "2026-09-16T09:00:00.000Z", 10)], Date.parse("2026-09-16T10:00:00.000Z"), Date.parse("2026-09-16T11:00:00.000Z"))).toBeUndefined();
  });
});
