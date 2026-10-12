// @vitest-environment node
// Стык, который подсвечивается под указателем: перед какой строкой встанет несомая или после какой.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { dropSeam, moveItem } from "./reorder";

describe("стык под несомой строкой", () => {
  it("на первом месте — перед первой из остальных строк", () => {
    expect(dropSeam(["a", "b", "c"], "c", 0)).toEqual({ id: "a", side: "before" });
  });

  it("на последнем месте — после последней из остальных строк", () => {
    expect(dropSeam(["a", "b", "c"], "a", 2)).toEqual({ id: "c", side: "after" });
  });

  it("между двумя — перед нижней из них", () => {
    expect(dropSeam(["a", "b", "c", "d"], "a", 2)).toEqual({ id: "d", side: "before" });
  });

  it("единственная строка стыка не имеет", () => {
    expect(dropSeam(["a"], "a", 0)).toBeNull();
  });

  it("подсвеченный стык и место несомой строки после переноса совпадают: она стоит сразу перед отмеченной строкой или сразу после неё", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 2, maxLength: 8 }), fc.nat(), fc.nat(), (ids, a, b) => {
        const from = a % ids.length;
        const to = b % ids.length;
        const seam = dropSeam(ids, ids[from]!, to)!;
        const after = moveItem(ids, from, to);
        const mark = after.indexOf(seam.id);
        expect(after.indexOf(ids[from]!)).toBe(seam.side === "before" ? mark - 1 : mark + 1);
      }),
    );
  });
});
