import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { roundedTopBarPath } from "./bar-geometry";

const finite = (opts?: { min?: number; max?: number }) =>
  fc.integer({ min: opts?.min ?? -1000, max: opts?.max ?? 1000 });
const positive = fc.integer({ min: 1, max: 1000 });

// Every (x, y) point the path actually visits, resolved through the command
// letters — H/V carry a single coordinate and move only one axis, so a naive
// even/odd split would misread them. Q's control point counts too: it must also
// stay in the box or the curve would bulge outside.
function pathPoints(d: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, rest] of d.matchAll(/([MHVLQZ])([^MHVLQZ]*)/g)) {
    const nums = (rest.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    switch (cmd) {
      case "M":
      case "L":
        [x, y] = nums;
        points.push({ x, y });
        break;
      case "H":
        [x] = nums;
        points.push({ x, y });
        break;
      case "V":
        [y] = nums;
        points.push({ x, y });
        break;
      case "Q":
        points.push({ x: nums[0], y: nums[1] });
        [x, y] = [nums[2], nums[3]];
        points.push({ x, y });
        break;
      // Z closes back to the start — no new point.
    }
  }
  return points;
}

describe("roundedTopBarPath — totality", () => {
  it("draws nothing for a non-positive width or height", () => {
    fc.assert(
      fc.property(finite(), finite(), fc.integer({ min: -1000, max: 0 }), positive, (x, y, wOrH, other) => {
        expect(roundedTopBarPath(x, y, wOrH, other, 3)).toBe("");
        expect(roundedTopBarPath(x, y, other, wOrH, 3)).toBe("");
      }),
    );
  });

  it("draws nothing when any argument is non-finite", () => {
    expect(roundedTopBarPath(Number.NaN, 0, 10, 10, 2)).toBe("");
    expect(roundedTopBarPath(0, 0, 10, 10, Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("roundedTopBarPath — a well-formed closed path", () => {
  it("starts with a move and ends closed, for any positive box", () => {
    fc.assert(
      fc.property(finite(), finite(), positive, positive, finite({ min: -50, max: 50 }), (x, y, w, h, r) => {
        const d = roundedTopBarPath(x, y, w, h, r);
        expect(d.startsWith("M")).toBe(true);
        expect(d.trimEnd().endsWith("Z")).toBe(true);
      }),
    );
  });

  it("keeps every coordinate inside the bar's own box", () => {
    fc.assert(
      fc.property(finite(), finite(), positive, positive, finite({ min: -50, max: 50 }), (x, y, w, h, r) => {
        const d = roundedTopBarPath(x, y, w, h, r);
        for (const p of pathPoints(d)) {
          expect(p.x).toBeGreaterThanOrEqual(x);
          expect(p.x).toBeLessThanOrEqual(x + w);
          expect(p.y).toBeGreaterThanOrEqual(y);
          expect(p.y).toBeLessThanOrEqual(y + h);
        }
      }),
    );
  });
});

describe("roundedTopBarPath — radius clamping", () => {
  it("a radius past what fits draws the same path as the largest that fits", () => {
    fc.assert(
      fc.property(positive, positive, (w, h) => {
        const fit = Math.min(w / 2, h);
        expect(roundedTopBarPath(0, 0, w, h, 10_000)).toBe(roundedTopBarPath(0, 0, w, h, fit));
      }),
    );
  });

  it("a negative radius draws the same square-cornered path as radius 0", () => {
    fc.assert(
      fc.property(positive, positive, fc.integer({ min: -1000, max: -1 }), (w, h, neg) => {
        expect(roundedTopBarPath(0, 0, w, h, neg)).toBe(roundedTopBarPath(0, 0, w, h, 0));
      }),
    );
  });
});
