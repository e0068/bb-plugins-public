// @vitest-environment node
import { describe, expect, it } from "vitest";

import { keepCells, moveCell, type RowLayout } from "./row-layout";

const layout: RowLayout = {
  rows: [
    { id: "r1", height: 200, minHeight: 120, cells: [{ id: "a", weight: 0.5 }, { id: "b", weight: 0.5 }] },
    { id: "r2", height: 240, minHeight: 120, cells: [{ id: "new", weight: 1 }] },
  ],
};

describe("keepCells — the layout with only the known tiles", () => {
  it("drops a cell no tile has, and keeps the tiles that share its row", () => {
    const mixed = moveCell(layout, "b", { kind: "row", rowId: "r2", index: 0 });
    const kept = keepCells(mixed, ["a", "b"]);
    expect(kept.rows.map((row) => row.cells.map((cell) => cell.id))).toEqual([["a"], ["b"]]);
    expect(kept.rows[1]!.cells[0]!.weight).toBeCloseTo(1, 9);
  });
});
