import { describe, expect, it } from "vitest";

import { drawnRows, FIRST_ROWS, ROW_STEP } from "./drawn-rows";

describe("drawnRows", () => {
  it("draws the first batch before the end of the list has come into reach", () => {
    expect(drawnRows(100, 0)).toBe(FIRST_ROWS);
  });

  it("adds a batch every time the end of the drawn rows comes into reach", () => {
    expect(drawnRows(100, 1)).toBe(FIRST_ROWS + ROW_STEP);
    expect(drawnRows(100, 2)).toBe(FIRST_ROWS + 2 * ROW_STEP);
  });

  it("never draws more rows than the list has", () => {
    expect(drawnRows(3, 0)).toBe(3);
    expect(drawnRows(FIRST_ROWS + 1, 1)).toBe(FIRST_ROWS + 1);
    expect(drawnRows(0, 5)).toBe(0);
  });
});
