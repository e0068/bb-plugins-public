import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { archiveButtonFace, type ArchiveButtonFace } from "./archive-button-face";
import type { ArchiveReason } from "./archive-readiness";

const UNVERIFIED: ArchiveReason = "tree-unverified";
const VERIFIED: ArchiveReason = "ready";

type Case = [string, Parameters<typeof archiveButtonFace>[0], ArchiveButtonFace];

// Every combination that can reach a RENDERED button: the two reasons a
// visible decision can carry, times hovering, times submitting.
const CASES: readonly Case[] = [
  ["verified, at rest", { reason: VERIFIED, hovering: false, submitting: false }, "action"],
  ["verified, hovered", { reason: VERIFIED, hovering: true, submitting: false }, "action"],
  ["verified, submitting", { reason: VERIFIED, hovering: false, submitting: true }, "submitting"],
  ["unverified, at rest", { reason: UNVERIFIED, hovering: false, submitting: false }, "warning"],
  ["unverified, hovered", { reason: UNVERIFIED, hovering: true, submitting: false }, "action"],
  ["unverified, submitting", { reason: UNVERIFIED, hovering: false, submitting: true }, "submitting"],
  [
    "unverified, hovered while submitting",
    { reason: UNVERIFIED, hovering: true, submitting: true },
    "submitting",
  ],
];

describe("archiveButtonFace", () => {
  it.each(CASES)("%s", (_name, input, expected) => {
    expect(archiveButtonFace(input)).toBe(expected);
  });

  it("hovering the warning reveals the action, and letting go restores the warning", () => {
    const at = (hovering: boolean) =>
      archiveButtonFace({ reason: UNVERIFIED, hovering, submitting: false });
    expect(at(true)).toBe("action");
    expect(at(false)).toBe("warning");
  });

  it("invariant: only an unverified tree can ever raise the warning face", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), fc.boolean(), (reason, hovering, submitting) => {
        if (archiveButtonFace({ reason, hovering, submitting }) === "warning") {
          expect(reason).toBe(UNVERIFIED);
        }
      }),
    );
  });

  it("invariant: an in-flight click always wins — no other input can hide it", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (reason, hovering) => {
        expect(archiveButtonFace({ reason, hovering, submitting: true })).toBe("submitting");
      }),
    );
  });
});
