import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { WINDOW_MS, WINDOWS, type Window, windowStartMs } from "./time-window";

// A now finite enough that adding/subtracting a 30-day span stays exact in
// double precision — property inputs, not real clocks.
const nowArb = fc.integer({ min: -8_640_000_000, max: 8_640_000_000 });
const windowArb: fc.Arbitrary<Window> = fc.constantFrom(...WINDOWS);

describe("windowStartMs", () => {
  it("opens exactly one window-length before now, for any window and now", () => {
    fc.assert(
      fc.property(windowArb, nowArb, (window, nowMs) => {
        expect(windowStartMs(window, nowMs)).toBe(nowMs - WINDOW_MS[window]);
      }),
    );
  });

  it("never opens in the future — the start is at or before now", () => {
    fc.assert(
      fc.property(windowArb, nowArb, (window, nowMs) => {
        expect(windowStartMs(window, nowMs)).toBeLessThanOrEqual(nowMs);
      }),
    );
  });
});

describe("WINDOW_MS", () => {
  it("orders the windows day < week < month", () => {
    expect(WINDOW_MS.day).toBeLessThan(WINDOW_MS.week);
    expect(WINDOW_MS.week).toBeLessThan(WINDOW_MS.month);
  });

  it("gives every declared window a positive length", () => {
    for (const window of WINDOWS) expect(WINDOW_MS[window]).toBeGreaterThan(0);
  });
});
