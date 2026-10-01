import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isHexColor, rampColors } from "./ramp";

const hex6 = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map((rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join(""));
const count = fc.integer({ min: 2, max: 40 });

describe("isHexColor", () => {
  it("accepts #rgb and #rrggbb in any case", () => {
    expect(["#abc", "#ABC", "#a1b2c3", "#A1B2C3"].every(isHexColor)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(["", "abc", "#ab", "#abcd", "#abcdeg", "#abcdef0", "red", "var(--x)", " #abc"].some(isHexColor)).toBe(false);
  });
});

describe("rampColors", () => {
  it("returns exactly `count` hex colours", () => {
    fc.assert(
      fc.property(hex6, hex6, count, (low, high, n) => {
        const steps = rampColors(low, high, n);
        expect(steps).toHaveLength(n);
        expect(steps.every(isHexColor)).toBe(true);
      }),
    );
  });

  it("starts exactly at low and ends exactly at high", () => {
    fc.assert(
      fc.property(hex6, hex6, count, (low, high, n) => {
        const steps = rampColors(low, high, n);
        expect(steps[0]).toBe(low);
        expect(steps[n - 1]).toBe(high);
      }),
    );
  });

  it("runs the same steps backwards when the ends are swapped", () => {
    fc.assert(
      fc.property(hex6, hex6, count, (low, high, n) => {
        expect(rampColors(high, low, n)).toEqual([...rampColors(low, high, n)].reverse());
      }),
    );
  });

  it("gives `count` copies when both ends are the same colour", () => {
    fc.assert(fc.property(hex6, count, (color, n) => {
          expect(rampColors(color, color, n)).toEqual(Array(n).fill(color));
        }));
  });

  it("gives one series the low colour", () => {
    expect(rampColors("#0000ff", "#ffffff", 1)).toEqual(["#0000ff"]);
  });

  it("gives nothing for no series", () => {
    expect(rampColors("#0000ff", "#ffffff", 0)).toEqual([]);
    expect(rampColors("#0000ff", "#ffffff", -3)).toEqual([]);
    expect(rampColors("#0000ff", "#ffffff", 2.5)).toEqual([]);
  });

  it("normalises the ends to lower-case #rrggbb", () => {
    expect(rampColors("#00F", "#FFF", 2)).toEqual(["#0000ff", "#ffffff"]);
  });

  it("steps blue to white through lighter blues, evenly in oklab", () => {
    expect(rampColors("#0000ff", "#ffffff", 6)).toEqual(["#0000ff", "#2260ff", "#598eff", "#8fb6ff", "#c6dbff", "#ffffff"]);
  });

  it("falls back to the valid end when the other one is not a colour", () => {
    expect(rampColors("#0000ff", "blue", 3)).toEqual(["#0000ff", "#0000ff", "#0000ff"]);
    expect(rampColors("nope", "#ffffff", 2)).toEqual(["#ffffff", "#ffffff"]);
  });

  it("gives nothing when neither end is a colour", () => {
    expect(rampColors("blue", "white", 4)).toEqual([]);
  });
});
