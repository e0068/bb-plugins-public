import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dropIndexForPointer, dropNeighborsForIndex, gridDropIndex } from "./drop-position.js";

describe("dropNeighborsForIndex", () => {
  const column = ["a", "b", "c"];

  it("returns both neighbors for a drop between cards in another column", () => {
    expect(dropNeighborsForIndex(column, "dragged", 1)).toEqual({
      beforeTaskId: "a",
      afterTaskId: "b",
    });
  });

  it("returns only an after neighbor at the top of a column", () => {
    expect(dropNeighborsForIndex(column, "dragged", 0)).toEqual({
      beforeTaskId: null,
      afterTaskId: "a",
    });
  });

  it("returns only a before neighbor at the bottom of a column", () => {
    expect(dropNeighborsForIndex(column, "dragged", 3)).toEqual({
      beforeTaskId: "c",
      afterTaskId: null,
    });
  });

  it("returns no neighbors for an empty column", () => {
    expect(dropNeighborsForIndex([], "dragged", 0)).toEqual({
      beforeTaskId: null,
      afterTaskId: null,
    });
  });

  it("excludes the dragged card on a same-column reorder", () => {
    // Moving "a" one visual slot down lands between "b" and "c".
    expect(dropNeighborsForIndex(column, "a", 1)).toEqual({
      beforeTaskId: "b",
      afterTaskId: "c",
    });
  });

  it("clamps out-of-range indexes into the column", () => {
    expect(dropNeighborsForIndex(column, "dragged", 99)).toEqual({
      beforeTaskId: "c",
      afterTaskId: null,
    });
    expect(dropNeighborsForIndex(column, "dragged", -1)).toEqual({
      beforeTaskId: null,
      afterTaskId: "a",
    });
  });
});

describe("dropIndexForPointer", () => {
  const centers = [10, 30, 50];

  it("maps a pointer above every card to the top slot", () => {
    expect(dropIndexForPointer(centers, 5)).toBe(0);
  });

  it("maps a pointer between card centers to the slot between them", () => {
    expect(dropIndexForPointer(centers, 20)).toBe(1);
    expect(dropIndexForPointer(centers, 40)).toBe(2);
  });

  it("maps a pointer below every card to the end slot", () => {
    expect(dropIndexForPointer(centers, 100)).toBe(3);
  });

  it("returns 0 for an empty column", () => {
    expect(dropIndexForPointer([], 42)).toBe(0);
  });
});

describe("gridDropIndex", () => {
  // Two rows of two cards, 100×50 each, 10px gaps: row-major order.
  const cards = [
    { left: 0, top: 0, width: 100, height: 50 },
    { left: 110, top: 0, width: 100, height: 50 },
    { left: 0, top: 60, width: 100, height: 50 },
    { left: 110, top: 60, width: 100, height: 50 },
  ];

  it("drops before the card under the pointer when the pointer is on its left half", () => {
    expect(gridDropIndex(cards, 130, 80)).toBe(3);
  });

  it("drops after the card under the pointer when the pointer is on its right half", () => {
    expect(gridDropIndex(cards, 80, 20)).toBe(1);
  });

  it("drops after the last card when the pointer is past the end of the grid", () => {
    expect(gridDropIndex(cards, 400, 300)).toBe(4);
  });

  it("drops first into an empty grid", () => {
    expect(gridDropIndex([], 10, 10)).toBe(0);
  });

  it("always gives a slot within the grid", () => {
    fc.assert(
      fc.property(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }), (x, y) => {
        const index = gridDropIndex(cards, x, y);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(cards.length);
      }),
    );
  });
});
