// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { dropIndex, moveItem } from "./reorder";

describe("перестановка строк", () => {
  it("перенос сохраняет набор строк и ставит строку на новое место", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer(), { minLength: 1 }), fc.nat(), fc.nat(), (list, a, b) => {
        const from = a % list.length;
        const to = b % list.length;
        const moved = moveItem(list, from, to);
        expect([...moved].sort()).toEqual([...list].sort());
        expect(moved[to]).toBe(list[from]);
      }),
    );
  });

  it("номер за пределами списка ничего не меняет", () => {
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("место под указателем — число середин строк выше него", () => {
    expect(dropIndex([10, 30, 50], 5)).toBe(0);
    expect(dropIndex([10, 30, 50], 31)).toBe(2);
    expect(dropIndex([10, 30, 50], 99)).toBe(2);
  });
});
