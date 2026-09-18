import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  decideMergeReadiness,
  parseMergeability,
  type ChecksState,
  type Mergeability,
  type PrState,
  type RawMergeable,
} from "./merge-readiness";

const prStates: PrState[] = ["closed", "draft", "merged", "open"];
const checksStates: ChecksState[] = ["failing", "no_checks", "passing", "pending", "unknown"];
const mergeabilities: Mergeability[] = ["conflicting", "mergeable", "unknown"];

describe("decideMergeReadiness", () => {
  it("PR open + checks passing + mergeable → visible, indicator success", () => {
    expect(
      decideMergeReadiness({ prState: "open", checksState: "passing", mergeability: "mergeable" }),
    ).toEqual({
      visible: true,
      indicator: "success",
    });
  });

  it("PR open + checks failing + mergeable → visible, indicator failure", () => {
    expect(
      decideMergeReadiness({ prState: "open", checksState: "failing", mergeability: "mergeable" }),
    ).toEqual({
      visible: true,
      indicator: "failure",
    });
  });

  it("PR open + checks running + mergeable → visible, indicator pending", () => {
    expect(
      decideMergeReadiness({ prState: "open", checksState: "pending", mergeability: "mergeable" }),
    ).toEqual({
      visible: true,
      indicator: "pending",
    });
  });

  it("PR open + no checks at all + mergeable → visible, indicator neutral", () => {
    expect(
      decideMergeReadiness({ prState: "open", checksState: "no_checks", mergeability: "mergeable" }),
    ).toEqual({
      visible: true,
      indicator: "neutral",
    });
  });

  it("PR open + checks status unknown + mergeable → visible, indicator unknown", () => {
    expect(
      decideMergeReadiness({ prState: "open", checksState: "unknown", mergeability: "mergeable" }),
    ).toEqual({
      visible: true,
      indicator: "unknown",
    });
  });

  it("PR open + checks passing but conflicting → visible, indicator conflict (conflict wins over checks)", () => {
    expect(
      decideMergeReadiness({ prState: "open", checksState: "passing", mergeability: "conflicting" }),
    ).toEqual({
      visible: true,
      indicator: "conflict",
    });
  });

  it("PR open + mergeability unknown → falls back to the checks-based indicator, not conflict", () => {
    expect(
      decideMergeReadiness({ prState: "open", checksState: "passing", mergeability: "unknown" }),
    ).toEqual({
      visible: true,
      indicator: "success",
    });
  });

  for (const prState of ["closed", "draft", "merged"] as const) {
    it(`PR not open (${prState}) — hides, regardless of checks or mergeability`, () => {
      expect(
        decideMergeReadiness({ prState, checksState: "passing", mergeability: "conflicting" }),
      ).toEqual({
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
        fc.constantFrom(...mergeabilities),
        (prState, checksState, mergeability) => {
          const { visible } = decideMergeReadiness({ prState, checksState, mergeability });
          expect(visible).toBe(prState === "open");
        },
      ),
    );
  });

  it("invariant: an open, conflicting PR always reports indicator conflict", () => {
    fc.assert(
      fc.property(fc.constantFrom(...checksStates), (checksState) => {
        const { indicator } = decideMergeReadiness({
          prState: "open",
          checksState,
          mergeability: "conflicting",
        });
        expect(indicator).toBe("conflict");
      }),
    );
  });
});

describe("parseMergeability", () => {
  it("CONFLICTING → conflicting", () => {
    expect(parseMergeability("CONFLICTING")).toBe("conflicting");
  });

  it("MERGEABLE → mergeable", () => {
    expect(parseMergeability("MERGEABLE")).toBe("mergeable");
  });

  it("UNKNOWN → unknown", () => {
    expect(parseMergeability("UNKNOWN")).toBe("unknown");
  });

  it("null (GitHub hasn't computed it yet) → unknown", () => {
    expect(parseMergeability(null)).toBe("unknown");
  });

  it("invariant: every raw value maps to a valid Mergeability, never throws", () => {
    const rawValues: RawMergeable[] = ["CONFLICTING", "MERGEABLE", "UNKNOWN", null];
    const validOutputs: Mergeability[] = ["conflicting", "mergeable", "unknown"];
    for (const raw of rawValues) {
      expect(validOutputs).toContain(parseMergeability(raw));
    }
  });
});
