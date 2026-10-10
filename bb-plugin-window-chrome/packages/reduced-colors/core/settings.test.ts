import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { rampColors } from "./ramp";
import { DEFAULT_REDUCED_COLORS, parseReducedColors, seriesColors, seriesPainting, type ReducedColors } from "./settings";

const hex6 = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map((rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join(""));
const pair = fc.record({ low: hex6, high: hex6 });
const settings: fc.Arbitrary<ReducedColors> = fc.record({ enabled: fc.boolean(), light: pair, dark: pair });
const mode = fc.constantFrom("light" as const, "dark" as const);
const count = fc.integer({ min: 0, max: 30 });
const palette = fc.array(fc.oneof(hex6, fc.constant("var(--muted-foreground)")), { minLength: 2, maxLength: 30 });

describe("parseReducedColors", () => {
  it("keeps a valid value as it is", () => {
    fc.assert(fc.property(settings, (value) => {
          expect(parseReducedColors(value)).toEqual(value);
        }));
  });

  it("turns anything into a value that parses to itself", () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const parsed = parseReducedColors(raw);
        expect(parseReducedColors(parsed)).toEqual(parsed);
      }),
    );
  });

  it("gives the defaults for a missing value", () => {
    expect(parseReducedColors(undefined)).toEqual(DEFAULT_REDUCED_COLORS);
  });

  it("takes each broken field from the defaults and keeps the rest", () => {
    expect(parseReducedColors({ enabled: "yes", light: { low: "#123456", high: "white" }, dark: 7 })).toEqual({
      enabled: DEFAULT_REDUCED_COLORS.enabled,
      light: { low: "#123456", high: DEFAULT_REDUCED_COLORS.light.high },
      dark: DEFAULT_REDUCED_COLORS.dark,
    });
  });

  it("starts switched off", () => {
    expect(DEFAULT_REDUCED_COLORS.enabled).toBe(false);
  });
});

describe("seriesColors", () => {
  it("returns the palette untouched while the mode is off", () => {
    fc.assert(
      fc.property(settings, mode, palette, (value, m, colors) => {
        expect(seriesColors({ ...value, enabled: false }, m, colors)).toEqual(colors);
      }),
    );
  });

  it("paints one step per series from the theme's low to its high while on", () => {
    fc.assert(
      fc.property(settings, mode, palette, (value, m, colors) => {
        const on = { ...value, enabled: true };
        expect(seriesColors(on, m, colors)).toEqual(rampColors(on[m].low, on[m].high, colors.length));
      }),
    );
  });

  it("uses the dark pair in the dark theme and the light pair in the light one", () => {
    const value: ReducedColors = { enabled: true, light: { low: "#000000", high: "#111111" }, dark: { low: "#eeeeee", high: "#ffffff" } };
    expect(seriesColors(value, "light", ["a", "b"])).toEqual(["#000000", "#111111"]);
    expect(seriesColors(value, "dark", ["a", "b"])).toEqual(["#eeeeee", "#ffffff"]);
  });
});

describe("seriesPainting", () => {
  it("keeps the palette while the mode is off", () => {
    fc.assert(
      fc.property(settings, mode, (value, m) => {
        expect(seriesPainting({ ...value, enabled: false }, m)).toEqual({ kind: "palette" });
      }),
    );
  });

  it("gives the theme's ramp while it is on", () => {
    fc.assert(
      fc.property(settings, mode, count, (value, m, n) => {
        const painting = seriesPainting({ ...value, enabled: true }, m);
        expect(painting.kind).toBe("ramp");
        if (painting.kind === "ramp") expect(painting.steps(n)).toEqual(rampColors(value[m].low, value[m].high, n));
      }),
    );
  });
});
