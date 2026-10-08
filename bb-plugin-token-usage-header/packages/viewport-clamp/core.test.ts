import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { VIEWPORT_MARGIN_PX, clampToViewport, type Point, type Size } from "./core";

const coord = fc.integer({ min: -4000, max: 4000 });
const extent = fc.integer({ min: 0, max: 3000 });
const point = fc.record({ x: coord, y: coord });
const size = fc.record({ width: extent, height: extent });
const viewport = fc.record({ width: fc.integer({ min: 100, max: 3000 }), height: fc.integer({ min: 100, max: 3000 }) });

const fits = (box: Size, view: Size): boolean =>
  box.width <= view.width - 2 * VIEWPORT_MARGIN_PX && box.height <= view.height - 2 * VIEWPORT_MARGIN_PX;

const inside = (at: Point, box: Size, view: Size): boolean =>
  at.x >= VIEWPORT_MARGIN_PX &&
  at.y >= VIEWPORT_MARGIN_PX &&
  at.x + box.width <= view.width - VIEWPORT_MARGIN_PX &&
  at.y + box.height <= view.height - VIEWPORT_MARGIN_PX;

describe("clampToViewport", () => {
  it("never places the box left of or above the margin", () => {
    fc.assert(
      fc.property(point, size, viewport, (at, box, view) => {
        const result = clampToViewport(at, box, view);
        return result.x >= VIEWPORT_MARGIN_PX && result.y >= VIEWPORT_MARGIN_PX;
      }),
    );
  });

  it("keeps a box that fits entirely inside the viewport, a margin from every edge", () => {
    fc.assert(
      fc.property(point, size, viewport, (at, box, view) => {
        fc.pre(fits(box, view));
        return inside(clampToViewport(at, box, view), box, view);
      }),
    );
  });

  it("leaves a box that already sits inside where it is", () => {
    const placed = viewport.chain((view) =>
      fc
        .record({
          width: fc.integer({ min: 0, max: view.width - 2 * VIEWPORT_MARGIN_PX }),
          height: fc.integer({ min: 0, max: view.height - 2 * VIEWPORT_MARGIN_PX }),
        })
        .chain((box) =>
          fc.record({
            view: fc.constant(view),
            box: fc.constant(box),
            at: fc.record({
              x: fc.integer({ min: VIEWPORT_MARGIN_PX, max: view.width - box.width - VIEWPORT_MARGIN_PX }),
              y: fc.integer({ min: VIEWPORT_MARGIN_PX, max: view.height - box.height - VIEWPORT_MARGIN_PX }),
            }),
          }),
        ),
    );
    fc.assert(
      fc.property(placed, ({ view, box, at }) => {
        expect(clampToViewport(at, box, view)).toEqual(at);
      }),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(point, size, viewport, (at, box, view) => {
        const once = clampToViewport(at, box, view);
        expect(clampToViewport(once, box, view)).toEqual(once);
      }),
    );
  });

  it("pulls a tooltip overflowing the right and bottom edges back in", () => {
    expect(clampToViewport({ x: 950, y: 700 }, { width: 200, height: 150 }, { width: 1000, height: 800 })).toEqual({
      x: 1000 - 200 - VIEWPORT_MARGIN_PX,
      y: 800 - 150 - VIEWPORT_MARGIN_PX,
    });
  });

  it("pins a box wider or taller than the viewport to the left and top margin", () => {
    expect(clampToViewport({ x: 300, y: 300 }, { width: 2000, height: 2000 }, { width: 1000, height: 800 })).toEqual({
      x: VIEWPORT_MARGIN_PX,
      y: VIEWPORT_MARGIN_PX,
    });
  });

  it("brings a point outside the viewport to the nearest margin", () => {
    expect(clampToViewport({ x: -50, y: 5000 }, { width: 0, height: 0 }, { width: 1000, height: 800 })).toEqual({
      x: VIEWPORT_MARGIN_PX,
      y: 800 - VIEWPORT_MARGIN_PX,
    });
  });

  it("takes a custom margin", () => {
    expect(clampToViewport({ x: 0, y: 0 }, { width: 10, height: 10 }, { width: 100, height: 100 }, 20)).toEqual({ x: 20, y: 20 });
  });
});
