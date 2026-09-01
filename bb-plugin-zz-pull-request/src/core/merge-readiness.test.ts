import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideMergeReadiness, type ChecksState, type PrState } from "./merge-readiness";

const prStates: PrState[] = ["closed", "draft", "merged", "open"];
const checksStates: ChecksState[] = ["failing", "no_checks", "passing", "pending", "unknown"];

describe("decideMergeReadiness", () => {
  it("PR открыт + проверки прошли → видна, индикатор success", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "passing" })).toEqual({
      visible: true,
      indicator: "success",
    });
  });

  it("PR открыт + проверки провалены → видна, индикатор failure", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "failing" })).toEqual({
      visible: true,
      indicator: "failure",
    });
  });

  it("PR открыт + проверки идут → видна, индикатор pending", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "pending" })).toEqual({
      visible: true,
      indicator: "pending",
    });
  });

  it("PR открыт + проверок нет вовсе → видна, индикатор neutral", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "no_checks" })).toEqual({
      visible: true,
      indicator: "neutral",
    });
  });

  it("PR открыт + статус проверок неизвестен → видна, индикатор unknown", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "unknown" })).toEqual({
      visible: true,
      indicator: "unknown",
    });
  });

  for (const prState of ["closed", "draft", "merged"] as const) {
    it(`PR не открыт (${prState}) — прячет, чем бы ни были проверки`, () => {
      expect(decideMergeReadiness({ prState, checksState: "passing" })).toEqual({
        visible: false,
        indicator: "unknown",
      });
    });
  }

  it("инвариант: видна ⇔ prState === open", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...prStates),
        fc.constantFrom(...checksStates),
        (prState, checksState) => {
          const { visible } = decideMergeReadiness({ prState, checksState });
          expect(visible).toBe(prState === "open");
        },
      ),
    );
  });
});
