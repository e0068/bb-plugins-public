import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideArchiveButton, decideArchiveVisible, type Landing } from "./archive-readiness";
import type { WorkingTree } from "./working-tree";

const LANDINGS: readonly Landing[] = ["landed", "not-merged", "unknown", "unlanded-commits"];
const TREES: readonly WorkingTree[] = ["clean", "dirty", "unknown"];

const anyInput = fc.record({
  landing: fc.constantFrom(...LANDINGS),
  workingTree: fc.constantFrom(...TREES),
});

describe("decideArchiveVisible", () => {
  it("landed + clean tree → visible", () => {
    expect(decideArchiveVisible({ landing: "landed", workingTree: "clean" })).toEqual({
      visible: true,
      reason: "ready",
    });
  });

  it("landed but the tree could not be read → visible, flagged as unverified", () => {
    expect(decideArchiveVisible({ landing: "landed", workingTree: "unknown" })).toEqual({
      visible: true,
      reason: "tree-unverified",
    });
  });

  it("landed + uncommitted changes → hidden (dirty)", () => {
    expect(decideArchiveVisible({ landing: "landed", workingTree: "dirty" })).toEqual({
      visible: false,
      reason: "dirty",
    });
  });

  it("the work is not in the base → hidden (not-merged)", () => {
    expect(decideArchiveVisible({ landing: "not-merged", workingTree: "clean" })).toEqual({
      visible: false,
      reason: "not-merged",
    });
  });

  it("landed, then new commits piled on top → hidden (unlanded-commits)", () => {
    expect(decideArchiveVisible({ landing: "unlanded-commits", workingTree: "clean" })).toEqual({
      visible: false,
      reason: "unlanded-commits",
    });
  });

  it("nobody could say whether the work landed → hidden, silence is not evidence", () => {
    expect(decideArchiveVisible({ landing: "unknown", workingTree: "clean" })).toEqual({
      visible: false,
      reason: "landing-unknown",
    });
  });

  it("a disqualifying landing outranks the tree: unknown landing hides even a clean tree", () => {
    for (const workingTree of TREES) {
      expect(decideArchiveVisible({ landing: "unknown", workingTree }).visible).toBe(false);
    }
  });

  it("invariant: visible ⇒ the work landed and the tree is not dirty", () => {
    fc.assert(
      fc.property(anyInput, (input) => {
        if (decideArchiveVisible(input).visible) {
          expect(input.landing).toBe("landed");
          expect(input.workingTree).not.toBe("dirty");
        }
      }),
    );
  });

  it("invariant: \"ready\" is claimed only when both facts were actually measured", () => {
    fc.assert(
      fc.property(anyInput, (input) => {
        if (decideArchiveVisible(input).reason === "ready") {
          expect(input).toEqual({ landing: "landed", workingTree: "clean" });
        }
      }),
    );
  });

  it("invariant: every hidden decision names a fact that disqualified it, never \"ready\"", () => {
    fc.assert(
      fc.property(anyInput, (input) => {
        const { visible, reason } = decideArchiveVisible(input);
        if (!visible) expect(reason).not.toBe("ready");
      }),
    );
  });
});

// An archived thread is the one state where the work's own readiness stops
// mattering: bb already shows its native "Thread is archived / Unarchive"
// bar, and a second "Done & Archive" beside it offers an action that has
// nothing left to do.
describe("decideArchiveButton — an already archived thread", () => {
  it("hides the button, naming the archive as the reason", () => {
    expect(decideArchiveButton({ archived: true })).toEqual({
      visible: false,
      reason: "already-archived",
    });
  });

  it("a live thread is decided by the work alone — the same answer as before", () => {
    fc.assert(
      fc.property(fc.constantFrom(...LANDINGS), fc.constantFrom(...TREES), (landing, workingTree) => {
        expect(
          decideArchiveButton({ archived: false, readiness: { landing, workingTree } }),
        ).toEqual(decideArchiveVisible({ landing, workingTree }));
      }),
    );
  });
});
