// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { lookOf, togglePick, type PickTarget } from "./segment-pick";

const SERIES = ["a", "b", "c"];
const target = fc.record({ column: fc.integer({ min: 0, max: 4 }), seriesId: fc.option(fc.constantFrom(...SERIES), { nil: null }) });
const lit = (hover: PickTarget | null, selected: PickTarget | null) =>
  [0, 1, 2, 3, 4].flatMap((column) => SERIES.filter((series) => lookOf(hover, selected, column, series) === "lit").map((series) => `${column}:${series}`));

describe("lookOf — what a segment looks like under a hover and a pick", () => {
  it("lights every segment while nothing is hovered or picked", () => {
    expect(lit(null, null)).toHaveLength(5 * SERIES.length);
  });

  it("lights exactly the whole column, or exactly the one segment, a target names", () => {
    fc.assert(
      fc.property(target, (aim) => {
        const expected = aim.seriesId === null ? SERIES.map((series) => `${aim.column}:${series}`) : [`${aim.column}:${aim.seriesId}`];
        expect(lit(aim, null)).toEqual(expected);
        expect(lit(null, aim)).toEqual(expected);
      }),
    );
  });

  it("lets the hover show what a click would pick over what is picked", () => {
    fc.assert(
      fc.property(target, target, (hover, picked) => {
        expect(lit(hover, picked)).toEqual(lit(hover, null));
      }),
    );
  });
});

describe("togglePick — a click on the chart", () => {
  it("picks what was clicked, and a second click on it drops the pick", () => {
    fc.assert(
      fc.property(fc.option(target, { nil: null }), target, (current, clicked) => {
        expect(togglePick(togglePick(current, clicked), clicked)).toEqual(togglePick(current, clicked) === null ? clicked : null);
        expect(togglePick(null, clicked)).toEqual(clicked);
      }),
    );
  });

  it("moves from a segment to its whole column and back", () => {
    expect(togglePick({ column: 1, seriesId: "a" }, { column: 1, seriesId: null })).toEqual({ column: 1, seriesId: null });
    expect(togglePick({ column: 1, seriesId: null }, { column: 1, seriesId: "a" })).toEqual({ column: 1, seriesId: "a" });
  });
});
