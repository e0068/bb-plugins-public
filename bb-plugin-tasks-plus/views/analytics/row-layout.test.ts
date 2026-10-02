import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MIN_SHARE, resizeCells, resizeRow, type RowLayout } from "./row-layout";

const LAYOUT: RowLayout = {
  rows: [
    { id: "top", height: 80, minHeight: 64, cells: [{ id: "kpi", weight: 1 }] },
    {
      id: "mid",
      height: 240,
      minHeight: 160,
      cells: [
        { id: "a", weight: 0.5 },
        { id: "b", weight: 0.3 },
        { id: "c", weight: 0.2 },
      ],
    },
  ],
};

const weights = (layout: RowLayout, rowId: string) => layout.rows.find((row) => row.id === rowId)!.cells.map((cell) => cell.weight);
const total = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe("resizeCells — a splitter moves share between its two neighbours only", () => {
  it("gives the left neighbour what it takes from the right", () => {
    const next = resizeCells(LAYOUT, "mid", 1, 0.1);
    expect(weights(next, "mid").map((w) => +w.toFixed(6))).toEqual([0.6, 0.2, 0.2]);
  });

  it("keeps the row's total, every share above the minimum, the other cells and rows untouched", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 }), fc.double({ min: -2, max: 2, noNaN: true }), (index, delta) => {
        const next = resizeCells(LAYOUT, "mid", index, delta);
        const after = weights(next, "mid");
        const before = weights(LAYOUT, "mid");
        expect(total(after)).toBeCloseTo(total(before), 9);
        after.forEach((w, i) => (i === index - 1 || i === index ? expect(w).toBeGreaterThanOrEqual(MIN_SHARE - 1e-9) : expect(w).toBe(before[i])));
        expect(next.rows[0]).toBe(LAYOUT.rows[0]);
      }),
    );
  });

  it("ignores a splitter that does not exist", () => {
    expect(resizeCells(LAYOUT, "mid", 0, 0.1)).toBe(LAYOUT);
    expect(resizeCells(LAYOUT, "mid", 3, 0.1)).toBe(LAYOUT);
    expect(resizeCells(LAYOUT, "nope", 1, 0.1)).toBe(LAYOUT);
  });
});

describe("resizeRow — the splitter under a row sets that row's height only", () => {
  it("sets the height, never below the row's minimum", () => {
    expect(resizeRow(LAYOUT, "mid", 300).rows[1]!.height).toBe(300);
    expect(resizeRow(LAYOUT, "mid", 10).rows[1]!.height).toBe(160);
    expect(resizeRow(LAYOUT, "mid", 300).rows[0]).toBe(LAYOUT.rows[0]);
  });

  it("rounds to whole pixels", () => {
    expect(resizeRow(LAYOUT, "mid", 250.6).rows[1]!.height).toBe(251);
  });
});
