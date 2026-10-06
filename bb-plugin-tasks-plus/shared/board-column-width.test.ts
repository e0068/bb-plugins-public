import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkColumnWidthBounds,
  clampToBounds,
  COLUMN_WIDTH_LIMITS,
  DEFAULT_COLUMN_WIDTH_BOUNDS,
  parseColumnWidthBounds,
} from "./board-column-width";

const { floor, ceiling } = COLUMN_WIDTH_LIMITS;

// Bounds with min <= initial <= max, every number inside the hard limits.
const validBounds = fc
  .tuple(fc.integer({ min: floor, max: ceiling }), fc.integer({ min: floor, max: ceiling }), fc.integer({ min: floor, max: ceiling }))
  .map((triple) => {
    const [min, initial, max] = [...triple].sort((a, b) => a - b);
    return { min, initial, max };
  });

describe("the default bounds — what the board drew before they became settings", () => {
  it("are 200, 480 and 230 px", () => {
    expect(DEFAULT_COLUMN_WIDTH_BOUNDS).toEqual({ min: 200, max: 480, initial: 230 });
  });

  it("pass their own check", () => {
    expect(checkColumnWidthBounds(DEFAULT_COLUMN_WIDTH_BOUNDS)).toEqual({ ok: true, bounds: DEFAULT_COLUMN_WIDTH_BOUNDS });
  });
});

describe("checkColumnWidthBounds — which three numbers the owner may save", () => {
  it("accepts any whole numbers inside the limits with min <= default <= max", () => {
    fc.assert(
      fc.property(validBounds, (bounds) => {
        expect(checkColumnWidthBounds(bounds)).toEqual({ ok: true, bounds });
      }),
    );
  });

  it("accepts the last allowed and refuses the first disallowed number at both limits", () => {
    expect(checkColumnWidthBounds({ min: floor, initial: floor, max: floor }).ok).toBe(true);
    expect(checkColumnWidthBounds({ min: ceiling, initial: ceiling, max: ceiling }).ok).toBe(true);
    expect(checkColumnWidthBounds({ min: floor - 1, initial: 230, max: 480 }).ok).toBe(false);
    expect(checkColumnWidthBounds({ min: 200, initial: 230, max: ceiling + 1 }).ok).toBe(false);
  });

  it("refuses a minimum above the maximum, naming the pair", () => {
    const checked = checkColumnWidthBounds({ min: 500, initial: 500, max: 300 });
    expect(checked).toEqual({ ok: false, reason: "Minimum must not exceed maximum." });
  });

  it("refuses a default outside the minimum and maximum", () => {
    const reason = "Default width must lie between minimum and maximum.";
    expect(checkColumnWidthBounds({ min: 200, initial: 199, max: 480 })).toEqual({ ok: false, reason });
    expect(checkColumnWidthBounds({ min: 200, initial: 481, max: 480 })).toEqual({ ok: false, reason });
  });

  it("refuses what is not a whole number of pixels", () => {
    const reason = "Enter whole numbers of pixels.";
    for (const min of [Number.NaN, 200.5, "200", null, undefined]) {
      expect(checkColumnWidthBounds({ min, initial: 230, max: 480 })).toEqual({ ok: false, reason });
    }
    for (const raw of [null, undefined, 3, "x", []]) {
      expect(checkColumnWidthBounds(raw)).toEqual({ ok: false, reason });
    }
  });
});

describe("parseColumnWidthBounds — a stored value read back", () => {
  it("keeps stored bounds that pass the check", () => {
    fc.assert(
      fc.property(validBounds, (bounds) => {
        expect(parseColumnWidthBounds(bounds)).toEqual(bounds);
      }),
    );
  });

  it("reads anything else as the default", () => {
    for (const raw of [undefined, null, {}, { min: 600, initial: 600, max: 300 }, { min: "200", initial: 230, max: 480 }, 7]) {
      expect(parseColumnWidthBounds(raw)).toEqual(DEFAULT_COLUMN_WIDTH_BOUNDS);
    }
  });
});

describe("clampToBounds — a width held inside the owner's range", () => {
  it("lands inside min..max as a whole number, whatever came in", () => {
    fc.assert(
      fc.property(validBounds, fc.double({ min: -5000, max: 9000, noNaN: true }), (bounds, width) => {
        const clamped = clampToBounds(bounds, width);
        expect(Number.isInteger(clamped)).toBe(true);
        expect(clamped).toBeGreaterThanOrEqual(bounds.min);
        expect(clamped).toBeLessThanOrEqual(bounds.max);
      }),
    );
  });

  it("leaves a width inside the range as it is", () => {
    fc.assert(
      fc.property(validBounds, (bounds) => {
        expect(clampToBounds(bounds, bounds.initial)).toBe(bounds.initial);
      }),
    );
  });

  it("pulls a width past either edge to that edge", () => {
    expect(clampToBounds({ min: 300, initial: 400, max: 700 }, 100)).toBe(300);
    expect(clampToBounds({ min: 300, initial: 400, max: 700 }, 900)).toBe(700);
  });
});
