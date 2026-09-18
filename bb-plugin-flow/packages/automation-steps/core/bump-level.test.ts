import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { bumpBy, bumpPatch, type BumpLevel } from "./plugin-version-bump";

const LEVELS: readonly BumpLevel[] = ["major", "minor", "patch"];

const parse = (version: string): readonly [number, number, number] => {
  const [major, minor, patch] = version.split(".").map(Number);
  return [major ?? 0, minor ?? 0, patch ?? 0];
};

const isAbove = (a: string, b: string): boolean => {
  const [am, an, ap] = parse(a);
  const [bm, bn, bp] = parse(b);
  return (am - bm || an - bn || ap - bp) > 0;
};

describe("bumpBy", () => {
  it("major raises the major component and zeroes the lower ones", () => {
    expect(bumpBy(0, 1, 4, "major")).toBe("1.0.0");
    expect(bumpBy(2, 7, 9, "major")).toBe("3.0.0");
  });

  it("minor raises the minor component and zeroes the patch", () => {
    expect(bumpBy(0, 1, 4, "minor")).toBe("0.2.0");
    expect(bumpBy(2, 7, 9, "minor")).toBe("2.8.0");
  });

  it("patch answers exactly what bumpPatch does", () => {
    for (const [major, minor, patch] of [
      [0, 1, 4],
      [2, 7, 9],
      [10, 0, 0],
    ] as const) {
      expect(bumpBy(major, minor, patch, "patch")).toBe(bumpPatch(major, minor, patch));
    }
  });

  it("answers a version strictly above the input at every level", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 500 }),
        fc.nat({ max: 500 }),
        fc.nat({ max: 500 }),
        fc.constantFrom(...LEVELS),
        (major, minor, patch, level) => {
          expect(isAbove(bumpBy(major, minor, patch, level), `${major}.${minor}.${patch}`)).toBe(true);
        },
      ),
    );
  });
});
