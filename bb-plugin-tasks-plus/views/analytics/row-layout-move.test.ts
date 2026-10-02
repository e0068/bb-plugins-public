// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { insertCell, insertRow, moveCell, removeCell, type RowLayout } from "./row-layout";

const layout: RowLayout = {
  rows: [
    { id: "r1", height: 200, minHeight: 120, cells: [{ id: "a", weight: 0.6 }, { id: "b", weight: 0.4 }] },
    { id: "r2", height: 240, minHeight: 120, cells: [{ id: "c", weight: 1 }] },
  ],
};

const cellIds = (value: RowLayout) => value.rows.flatMap((row) => row.cells.map((cell) => cell.id));
const sound = (value: RowLayout) =>
  value.rows.every((row) => row.cells.length > 0 && Math.abs(row.cells.reduce((sum, cell) => sum + cell.weight, 0) - 1) < 1e-9) &&
  new Set(cellIds(value)).size === cellIds(value).length;

describe("moving, adding and removing cells", () => {
  it("moves a cell into another row at a place, the rows' widths summing to 1", () => {
    const moved = moveCell(layout, "b", { kind: "row", rowId: "r2", index: 0 });
    expect(moved.rows.map((row) => row.cells.map((cell) => cell.id))).toEqual([["a"], ["b", "c"]]);
    expect(sound(moved)).toBe(true);
  });

  it("moves a cell into a new row of its own under a row, and drops the row it empties", () => {
    const moved = moveCell(layout, "c", { kind: "newRow", afterRowId: "r1" });
    expect(moved.rows.map((row) => row.cells.map((cell) => cell.id))).toEqual([["a", "b"], ["c"]]);
    const lifted = moveCell(layout, "a", { kind: "newRow", afterRowId: null });
    expect(lifted.rows.map((row) => row.cells.map((cell) => cell.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(sound(lifted)).toBe(true);
  });

  it("adds a cell right after another in its row, and a row at the bottom", () => {
    expect(insertCell(layout, "a", "d").rows[0]!.cells.map((cell) => cell.id)).toEqual(["a", "d", "b"]);
    const grown = insertRow(layout, "e", 260);
    expect(grown.rows.at(-1)).toMatchObject({ height: 260, cells: [{ id: "e", weight: 1 }] });
  });

  it("removes a cell, and its row when it was the last there", () => {
    expect(cellIds(removeCell(layout, "c"))).toEqual(["a", "b"]);
    expect(removeCell(layout, "c").rows).toHaveLength(1);
  });

  it("keeps every row sound and every cell once, whatever the chain of changes", () => {
    const step = fc.oneof(
      fc.record({ op: fc.constant("move" as const), cell: fc.constantFrom("a", "b", "c"), row: fc.constantFrom("r1", "r2"), index: fc.nat(3), newRow: fc.boolean() }),
      fc.record({ op: fc.constant("insert" as const), after: fc.constantFrom("a", "b", "c"), id: fc.constantFrom("x", "y") }),
      fc.record({ op: fc.constant("remove" as const), cell: fc.constantFrom("a", "b", "c", "x", "y") }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 12 }), (steps) => {
        const end = steps.reduce<RowLayout>((current, change) => {
          switch (change.op) {
            case "move":
              return moveCell(current, change.cell, change.newRow ? { kind: "newRow", afterRowId: change.row } : { kind: "row", rowId: change.row, index: change.index });
            case "insert":
              return cellIds(current).includes(change.id) ? current : insertCell(current, change.after, change.id);
            case "remove":
              return removeCell(current, change.cell);
          }
        }, layout);
        expect(sound(end)).toBe(true);
      }),
    );
  });
});
