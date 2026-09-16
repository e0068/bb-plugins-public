import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { laneSegments } from "./lane-geometry";

const weightsArb = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 30 });
const widthArb = fc.integer({ min: 0, max: 10_000 });
const gapArb = fc.integer({ min: 0, max: 40 });

const EPS = 1e-6;

describe("laneSegments — conservation & non-overlap", () => {
  it("segment widths sum to the drawable width (total minus the gaps)", () => {
    fc.assert(
      fc.property(weightsArb, widthArb, gapArb, (weights, totalWidth, gapPx) => {
        const segments = laneSegments(weights, totalWidth, gapPx);
        const drawable = Math.max(totalWidth - gapPx * (weights.length - 1), 0);
        const sum = segments.reduce((acc, s) => acc + s.width, 0);
        expect(sum).toBeCloseTo(drawable, 6);
      }),
    );
  });

  it("lays segments in order with no overlap; no drawn segment runs past totalWidth", () => {
    fc.assert(
      fc.property(weightsArb, widthArb, gapArb, (weights, totalWidth, gapPx) => {
        const segments = laneSegments(weights, totalWidth, gapPx);
        for (let i = 0; i < segments.length; i++) {
          expect(segments[i].width).toBeGreaterThanOrEqual(0);
          if (i > 0) {
            const prev = segments[i - 1];
            expect(segments[i].x).toBeGreaterThanOrEqual(prev.x + prev.width - EPS);
          }
          // A zero-width segment is never drawn (LaneTimeline skips it), so its x
          // may sit past the lane when the gaps alone already overflow it; only a
          // segment that actually paints pixels must stay inside the lane.
          if (segments[i].width > 0) {
            expect(segments[i].x + segments[i].width).toBeLessThanOrEqual(totalWidth + EPS);
          }
        }
      }),
    );
  });

  it("gives each segment a share of the drawable width proportional to its weight", () => {
    fc.assert(
      fc.property(weightsArb, fc.integer({ min: 100, max: 10_000 }), (weights, totalWidth) => {
        const segments = laneSegments(weights, totalWidth, 0);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        if (totalWeight === 0) return; // equal-split branch covered separately
        weights.forEach((w, i) => {
          expect(segments[i].width).toBeCloseTo((w / totalWeight) * totalWidth, 6);
        });
      }),
    );
  });
});

describe("laneSegments — degenerate input", () => {
  it("returns no segments for an empty lane", () => {
    expect(laneSegments([], 100, 4)).toEqual([]);
  });

  it("splits an all-zero-weight lane into equal slots", () => {
    const segments = laneSegments([0, 0, 0, 0], 100, 0);
    for (const s of segments) expect(s.width).toBeCloseTo(25, 6);
  });

  it("yields zero-width segments when the gaps already exceed the width", () => {
    const segments = laneSegments([1, 1, 1], 2, 100);
    for (const s of segments) expect(s.width).toBe(0);
  });

  it("treats a non-finite weight as zero", () => {
    const segments = laneSegments([Number.NaN, 10], 100, 0);
    expect(segments[0].width).toBeCloseTo(0, 6);
    expect(segments[1].width).toBeCloseTo(100, 6);
  });

  it("yields finite, in-order zero-width segments when totalWidth is non-finite", () => {
    const segments = laneSegments([1, 1], Number.POSITIVE_INFINITY, 0);
    expect(segments.map((s) => s.width)).toEqual([0, 0]);
    expect(segments[1].x).toBeGreaterThanOrEqual(segments[0].x);
  });

  it("treats a non-finite gap as zero rather than poisoning the layout", () => {
    const segments = laneSegments([1, 1], 100, Number.NaN);
    for (const s of segments) expect(Number.isFinite(s.width)).toBe(true);
    expect(segments[0].width + segments[1].width).toBeCloseTo(100, 6);
  });
});
