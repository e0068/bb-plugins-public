import { describe, expect, it } from "vitest";
import { mergeButtonLabel } from "./merge-button-label";

describe("mergeButtonLabel", () => {
  it("with the PR-link segment beside it the number is left to the link — the action says just \"Merge\"", () => {
    expect(mergeButtonLabel({ conflicting: false, number: 275, linked: true })).toBe("Merge");
  });

  it("without the link segment the number moves into the action itself", () => {
    expect(mergeButtonLabel({ conflicting: false, number: 275, linked: false })).toBe("Merge #275");
  });

  it("no number at all → the bare action", () => {
    expect(mergeButtonLabel({ conflicting: false, number: null, linked: false })).toBe("Merge");
  });

  // GitHub refuses the merge outright on a real conflict, so the button says
  // what stops it instead of which PR it would merge — the way GitHub's own
  // "Merge conflicts" state reads.
  it("a conflict outranks every number — the label names the blocker", () => {
    expect(mergeButtonLabel({ conflicting: true, number: 275, linked: true })).toBe("Conflicts");
    expect(mergeButtonLabel({ conflicting: true, number: 275, linked: false })).toBe("Conflicts");
    expect(mergeButtonLabel({ conflicting: true, number: null, linked: false })).toBe("Conflicts");
  });
});
