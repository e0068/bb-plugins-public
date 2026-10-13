import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { shadeRects, type Box } from "./shade-rects";

const size = fc.integer({ min: 0, max: 3000 });
const viewport = fc.record({ width: size, height: size });
// A hole may stick out of the viewport on any side — a panel scrolled or
// resized past the window edge — so its corner ranges past both ends.
const hole = fc.record({
  left: fc.integer({ min: -500, max: 3500 }),
  top: fc.integer({ min: -500, max: 3500 }),
  width: size,
  height: size,
});

const area = (b: Box) => b.width * b.height;
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

describe("shadeRects — properties", () => {
  it("no shade has a negative side", () => {
    fc.assert(
      fc.property(hole, viewport, (h, v) => {
        for (const r of shadeRects(h, v)) {
          expect(r.width).toBeGreaterThanOrEqual(0);
          expect(r.height).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("no shade covers any part of the hole", () => {
    fc.assert(
      fc.property(hole, viewport, (h, v) => {
        for (const r of shadeRects(h, v)) expect(overlap(r, h)).toBe(0);
      }),
    );
  });

  it("the shades cover the whole viewport except the hole, without overlapping", () => {
    fc.assert(
      fc.property(hole, viewport, (h, v) => {
        const screen = { left: 0, top: 0, ...v };
        const shades = shadeRects(h, v);
        const covered = shades.reduce((sum, r) => sum + overlap(r, screen), 0);
        expect(covered).toBe(area(screen) - overlap(h, screen));
        for (let i = 0; i < shades.length; i++) {
          for (let j = i + 1; j < shades.length; j++) {
            expect(overlap(shades[i], shades[j])).toBe(0);
          }
        }
      }),
    );
  });
});
