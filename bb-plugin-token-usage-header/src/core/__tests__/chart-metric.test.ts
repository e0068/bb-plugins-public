import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CHART_METRIC, parseChartMetric } from "../gear-settings";
import { formatAmount, formatAmountLabel } from "../format";
import { agentAmount, binAmount, type AgentBin, type TimelineBin } from "../threads-timeline";

describe("parseChartMetric", () => {
  it("reads tokens until the owner picks otherwise", () => {
    expect(DEFAULT_CHART_METRIC).toBe("tokens");
    expect(parseChartMetric(undefined)).toBe("tokens");
    expect(parseChartMetric({})).toBe("tokens");
  });

  it("reads the cost metric the owner picked", () => {
    expect(parseChartMetric({ chartMetric: "cost" })).toBe("cost");
    expect(parseChartMetric({ chartMetric: "tokens" })).toBe("tokens");
  });

  it("falls back to tokens on a value it does not know", () => {
    expect(parseChartMetric({ chartMetric: "dollars" })).toBe("tokens");
    expect(parseChartMetric({ chartMetric: true })).toBe("tokens");
  });
});

describe("agentAmount and binAmount", () => {
  const cheapCache: AgentBin = { key: "main", total: 900_000, cost: 0.27 };
  const pricyOutput: AgentBin = { key: "agent-a", total: 20_000, cost: 1.5 };

  it("measures a segment in tokens or in dollars by the metric", () => {
    expect(agentAmount(cheapCache, "tokens")).toBe(900_000);
    expect(agentAmount(cheapCache, "cost")).toBe(0.27);
  });

  it("measures a segment without a price as zero dollars", () => {
    expect(agentAmount({ key: "main", total: 500 }, "cost")).toBe(0);
  });

  it("sums a bin's segments under the chosen metric", () => {
    const bin: TimelineBin = { t: "2026-09-03T11:00:00.000Z", agents: [cheapCache, pricyOutput] };
    expect(binAmount(bin, "tokens")).toBe(920_000);
    expect(binAmount(bin, "cost")).toBeCloseTo(1.77, 10);
  });

  it("law: a bin's amount is the sum of its segments' amounts", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ key: fc.string(), total: fc.nat(), cost: fc.double({ min: 0, max: 100, noNaN: true }) })),
        fc.constantFrom("tokens" as const, "cost" as const),
        (agents, metric) => {
          const bin: TimelineBin = { t: "2026-09-03T11:00:00.000Z", agents };
          expect(binAmount(bin, metric)).toBeCloseTo(
            agents.reduce((sum, agent) => sum + agentAmount(agent, metric), 0),
            6,
          );
        },
      ),
    );
  });
});

describe("formatAmount", () => {
  it("writes tokens the way the charts always did", () => {
    expect(formatAmount(1_200_000, "tokens")).toBe("1.2M");
    expect(formatAmount(3_400, "tokens")).toBe("3.4k");
  });

  it("writes dollars in cents", () => {
    expect(formatAmount(1.234, "cost")).toBe("$1.23");
    expect(formatAmount(0.01, "cost")).toBe("$0.01");
  });

  it("writes a nonzero amount under a cent as below a cent, not as zero", () => {
    expect(formatAmount(0.004, "cost")).toBe("<$0.01");
    expect(formatAmount(0, "cost")).toBe("$0.00");
  });
});

describe("formatAmountLabel", () => {
  it("names the unit of a token amount and leaves dollars to their sign", () => {
    expect(formatAmountLabel(100, "tokens")).toBe("100 tokens");
    expect(formatAmountLabel(0.3, "cost")).toBe("$0.30");
  });
});
