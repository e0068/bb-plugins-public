import { describe, expect, it } from "vitest";
import { estimateTokens, formatWeight } from "../src/weight";

describe("estimateTokens", () => {
  it("~4 characters per token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("formatWeight", () => {
  it("under a thousand — as-is", () => {
    expect(formatWeight(0)).toBe("~0");
    expect(formatWeight(340)).toBe("~340");
    expect(formatWeight(999)).toBe("~999");
  });

  it("thousands — with k, a fraction up to 10k", () => {
    expect(formatWeight(1200)).toBe("~1.2k");
    expect(formatWeight(9990)).toBe("~10.0k");
    expect(formatWeight(12000)).toBe("~12k");
  });
});
