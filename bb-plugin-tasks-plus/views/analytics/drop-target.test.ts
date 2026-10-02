// @vitest-environment node
import { describe, expect, it } from "vitest";

import { dropTarget, type RowBox } from "./row-layout";

// Two rows: r1 holds a (0–100) and b (110–200) at y 0–100; r2 holds c (0–200) at y 112–212.
const ROWS: RowBox[] = [
  { id: "r1", top: 0, bottom: 100, cells: [{ id: "a", left: 0, right: 100 }, { id: "b", left: 110, right: 200 }] },
  { id: "r2", top: 112, bottom: 212, cells: [{ id: "c", left: 0, right: 200 }] },
];

describe("dropTarget — where a dragged tile lands", () => {
  it("lands in the row under the pointer, before the first cell whose middle is right of it", () => {
    expect(dropTarget(ROWS, 20, 50)).toEqual({ kind: "row", rowId: "r1", index: 0 });
    expect(dropTarget(ROWS, 120, 50)).toEqual({ kind: "row", rowId: "r1", index: 1 });
    expect(dropTarget(ROWS, 190, 50)).toEqual({ kind: "row", rowId: "r1", index: 2 });
    expect(dropTarget(ROWS, 150, 150)).toEqual({ kind: "row", rowId: "r2", index: 1 });
  });

  it("opens a row of its own between rows, above the first and under the last", () => {
    expect(dropTarget(ROWS, 50, 106)).toEqual({ kind: "newRow", afterRowId: "r1" });
    expect(dropTarget(ROWS, 50, -10)).toEqual({ kind: "newRow", afterRowId: null });
    expect(dropTarget(ROWS, 50, 400)).toEqual({ kind: "newRow", afterRowId: "r2" });
  });
});
