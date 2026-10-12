// @vitest-environment node
// Куда встанет перетаскиваемая строка списка: место считается среди остальных строк, сама она не в счёте.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { placeAmong } from "./reorder";

/** Середины строк высотой 28 сверху вниз — строго по возрастанию, как на экране. */
const middlesOf = (count: number): number[] => Array.from({ length: count }, (_, i) => i * 28 + 14);

describe("место перетаскиваемой строки среди остальных", () => {
  it("указатель на самой строке оставляет её на месте", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), fc.nat(), (count, a) => {
        const grabbed = a % count;
        expect(placeAmong(middlesOf(count), grabbed, middlesOf(count)[grabbed]!)).toBe(grabbed);
      }),
    );
  });

  it("выше всех строк — первое место, ниже всех — последнее", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), fc.nat(), (count, a) => {
        const grabbed = a % count;
        expect(placeAmong(middlesOf(count), grabbed, -1000)).toBe(0);
        expect(placeAmong(middlesOf(count), grabbed, 1000)).toBe(count - 1);
      }),
    );
  });

  it("чем ниже указатель, тем место не выше", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 9 }), fc.nat(), fc.integer({ min: -50, max: 400 }), fc.nat({ max: 100 }), (count, a, y, dy) => {
        const grabbed = a % count;
        expect(placeAmong(middlesOf(count), grabbed, y + dy)).toBeGreaterThanOrEqual(placeAmong(middlesOf(count), grabbed, y));
      }),
    );
  });

  it("первая строка за указателем между второй и третьей встаёт на второе место, выше середины второй — остаётся первой", () => {
    expect(placeAmong(middlesOf(4), 0, 60)).toBe(1);
    expect(placeAmong(middlesOf(4), 0, 30)).toBe(0);
  });

  it("единственная строка остаётся на нулевом месте", () => {
    expect(placeAmong([14], 0, 500)).toBe(0);
  });
});
