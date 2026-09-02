import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideMergeReadiness, type ChecksState, type PrState } from "./merge-readiness";

const prStates: PrState[] = ["closed", "draft", "merged", "open"];
const checksStates: ChecksState[] = ["failing", "no_checks", "passing", "pending", "unknown"];

describe("decideMergeReadiness", () => {
  it("PR open + checks passing → visible, indicator success", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "passing" })).toEqual({
      visible: true,
      indicator: "success",
    });
  });

  it("PR open + checks failing → visible, indicator failure", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "failing" })).toEqual({
      visible: true,
      indicator: "failure",
    });
  });

  it("PR open + checks running → visible, indicator pending", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "pending" })).toEqual({
      visible: true,
      indicator: "pending",
    });
  });

  it("PR open + no checks at all → visible, indicator neutral", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "no_checks" })).toEqual({
      visible: true,
      indicator: "neutral",
    });
  });

  it("PR open + checks status unknown → visible, indicator unknown", () => {
    expect(decideMergeReadiness({ prState: "open", checksState: "unknown" })).toEqual({
      visible: true,
      indicator: "unknown",
    });
  });

  for (const prState of ["closed", "draft", "merged"] as const) {
    it(`PR not open (${prState}) — hides, regardless of checks`, () => {
      expect(decideMergeReadiness({ prState, checksState: "passing" })).toEqual({
        visible: false,
        indicator: "unknown",
      });
    });
  }

  it("invariant: visible ⇔ prState === open", () => {
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
