import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dropEdge, moveColumn, TABLE_COLUMNS } from "./columns.js";

describe("the drop line of a dragged column", () => {
  it("draws on the side of the target header the column actually lands against", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...TABLE_COLUMNS], { minLength: 2 }),
        fc.nat(),
        fc.nat(),
        (columns, fromSeed, toSeed) => {
          const fromIndex = fromSeed % columns.length;
          const toIndex = toSeed % columns.length;
          const moved = columns[fromIndex]!;
          const target = columns[toIndex]!;
          const after = moveColumn(columns, [], moved, toIndex).columns;
          const edge = dropEdge(fromIndex, toIndex);
          if (edge === null) {
            expect(after).toEqual(columns);
            return;
          }
          const offset = edge === "before" ? 1 : -1;
          expect(after[after.indexOf(moved) + offset]).toBe(target);
        },
      ),
    );
  });

  it("draws nothing when the column is dropped onto itself", () => {
    expect(dropEdge(2, 2)).toBeNull();
    expect(dropEdge(0, 3)).toBe("after");
    expect(dropEdge(3, 0)).toBe("before");
  });
});
