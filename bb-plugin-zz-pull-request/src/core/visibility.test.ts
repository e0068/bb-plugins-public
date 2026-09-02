import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  decideVisibility,
  refineWithMergedContent,
  type PrPresence,
  type VisibilityDecision,
} from "./visibility";

const presences: PrPresence[] = ["absent", "open", "settled", "unknown"];

describe("decideVisibility", () => {
  it("visible exactly when clean, there are commits ahead, and PR is absent", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 3, pr: "absent" }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("PR merged/closed (settled) + new commit ahead → visible again", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 1, pr: "settled" }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("uncommitted changes hide the button", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: true, aheadCount: 3, pr: "absent" }),
    ).toEqual({ visible: false, reason: "dirty" });
  });

  it("no commits ahead — hides", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 0, pr: "absent" }),
    ).toEqual({ visible: false, reason: "nothing-to-pr" });
  });

  it("a live PR (open) — hides, regardless of everything else", () => {
    expect(decideVisibility({ hasUncommittedChanges: false, aheadCount: 5, pr: "open" })).toEqual(
      { visible: false, reason: "pr-exists" },
    );
  });

  it("PR status unknown — hides", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 5, pr: "unknown" }),
    ).toEqual({ visible: false, reason: "pr-unknown" });
  });

  it("invariant: visible ⇒ clean ∧ ahead>0 ∧ pr∈{absent,settled}", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: -2, max: 50 }),
        fc.constantFrom(...presences),
        (hasUncommittedChanges, aheadCount, pr) => {
          const { visible } = decideVisibility({ hasUncommittedChanges, aheadCount, pr });
          if (visible) {
            expect(hasUncommittedChanges).toBe(false);
            expect(aheadCount).toBeGreaterThan(0);
            expect(pr === "absent" || pr === "settled").toBe(true);
          }
        },
      ),
    );
  });
});

describe("refineWithMergedContent", () => {
  const ready: VisibilityDecision = { visible: true, reason: "ready" };

  it("the branch's content is already in the base → hides, even with aheadCount > 0", () => {
    expect(refineWithMergedContent(ready, true)).toEqual({
      visible: false,
      reason: "already-merged",
    });
  });

  it("the content is not in the base yet → the decision stands", () => {
    expect(refineWithMergedContent(ready, false)).toEqual(ready);
  });

  it("an already-hidden decision keeps its own reason — the fact cannot un-hide it", () => {
    const dirty: VisibilityDecision = { visible: false, reason: "dirty" };
    expect(refineWithMergedContent(dirty, false)).toEqual(dirty);
    expect(refineWithMergedContent(dirty, true)).toEqual(dirty);
  });

  it("property: refining never turns a hidden decision into a visible one", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (visible, alreadyMerged) => {
        const decision: VisibilityDecision = visible
          ? { visible: true, reason: "ready" }
          : { visible: false, reason: "nothing-to-pr" };
        const refined = refineWithMergedContent(decision, alreadyMerged);
        expect(refined.visible).toBe(visible && !alreadyMerged);
      }),
    );
  });
});
