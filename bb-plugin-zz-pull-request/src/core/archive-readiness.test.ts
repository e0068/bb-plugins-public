import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideArchiveVisible } from "./archive-readiness";
import type { PrState } from "./merge-readiness";

const PR_STATES: readonly (PrState | null)[] = ["closed", "draft", "merged", "open", null];

describe("decideArchiveVisible", () => {
  it("merged + clean → visible", () => {
    expect(
      decideArchiveVisible({ prState: "merged", hasUncommittedChanges: false }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("merged + uncommitted changes → hidden (dirty)", () => {
    expect(
      decideArchiveVisible({ prState: "merged", hasUncommittedChanges: true }),
    ).toEqual({ visible: false, reason: "dirty" });
  });

  it("open PR, clean → hidden (not-merged)", () => {
    expect(
      decideArchiveVisible({ prState: "open", hasUncommittedChanges: false }),
    ).toEqual({ visible: false, reason: "not-merged" });
  });

  it("closed without merging, clean → hidden (not-merged)", () => {
    expect(
      decideArchiveVisible({ prState: "closed", hasUncommittedChanges: false }),
    ).toEqual({ visible: false, reason: "not-merged" });
  });

  it("no PR at all, clean → hidden (not-merged)", () => {
    expect(
      decideArchiveVisible({ prState: null, hasUncommittedChanges: false }),
    ).toEqual({ visible: false, reason: "not-merged" });
  });

  it("invariant: visible ⇒ merged ∧ clean", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PR_STATES),
        fc.boolean(),
        (prState, hasUncommittedChanges) => {
          const { visible } = decideArchiveVisible({ prState, hasUncommittedChanges });
          if (visible) {
            expect(prState).toBe("merged");
            expect(hasUncommittedChanges).toBe(false);
          }
        },
      ),
    );
  });
});
