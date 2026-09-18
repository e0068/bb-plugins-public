import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideFastForward } from "./fast-forward";

describe("decideFastForward", () => {
  it("behind, no commits of our own, clean → visible", () => {
    expect(
      decideFastForward({ behindCount: 3, aheadCount: 0, hasUncommittedChanges: false }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("not behind → hidden (nothing to fast-forward)", () => {
    expect(
      decideFastForward({ behindCount: 0, aheadCount: 0, hasUncommittedChanges: false }),
    ).toEqual({ visible: false, reason: "up-to-date" });
  });

  it("commits of our own ahead while behind → hidden (diverged)", () => {
    expect(
      decideFastForward({ behindCount: 3, aheadCount: 2, hasUncommittedChanges: false }),
    ).toEqual({ visible: false, reason: "diverged" });
  });

  it("uncommitted changes → hidden regardless of everything else", () => {
    expect(
      decideFastForward({ behindCount: 3, aheadCount: 0, hasUncommittedChanges: true }),
    ).toEqual({ visible: false, reason: "dirty" });
  });

  it("invariant: visible ⇒ clean ∧ behind>0 ∧ ahead=0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2, max: 50 }),
        fc.integer({ min: -2, max: 50 }),
        fc.boolean(),
        (behindCount, aheadCount, hasUncommittedChanges) => {
          const { visible } = decideFastForward({
            behindCount,
            aheadCount,
            hasUncommittedChanges,
          });
          if (visible) {
            expect(hasUncommittedChanges).toBe(false);
            expect(behindCount).toBeGreaterThan(0);
            expect(aheadCount).toBeLessThanOrEqual(0);
          }
        },
      ),
    );
  });
});
