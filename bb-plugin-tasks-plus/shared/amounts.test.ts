import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatDollars, formatMinutes, readDollars, readMinutes, roundToCents } from "./amounts.js";

const cents = fc.integer({ min: 0, max: 100_000_000 }).map((n) => n / 100);

describe("roundToCents", () => {
  it("is idempotent", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), (value) => {
      expect(roundToCents(roundToCents(value))).toBe(roundToCents(value));
    }));
  });

  it("rounds half-cents up where binary floats would round down", () => {
    expect(roundToCents(1.005)).toBe(1.01);
    expect(roundToCents(2.675)).toBe(2.68);
    expect(roundToCents(0.1 + 0.2)).toBe(0.3);
  });
});

describe("formatDollars and readDollars", () => {
  it("read back what they print, on whole cents", () => {
    fc.assert(fc.property(cents, (value) => {
      expect(readDollars(formatDollars(value))).toBe(value);
    }));
  });

  it("print whole dollars bare and the rest to two decimals", () => {
    expect(formatDollars(34)).toBe("$34");
    expect(formatDollars(34.1)).toBe("$34.10");
    expect(formatDollars(0)).toBe("$0");
  });
});

describe("formatMinutes and readMinutes", () => {
  it("print minutes, hours, and hours with minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(59)).toBe("59m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(61)).toBe("1h 1m");
  });

  it("read only plain decimal digits within the safe integer range", () => {
    expect(readMinutes("0x10")).toBeNull();
    expect(readMinutes("1e2")).toBeNull();
    expect(readMinutes(" 90 ")).toBe(90);
    expect(readMinutes(1e300)).toBeNull();
    expect(readMinutes("99999999999999999999")).toBeNull();
  });
});
