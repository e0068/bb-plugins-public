import { describe, expect, it } from "vitest";
import { clampWidth, nextWidthFromDrag } from "./geometry";

describe("clampWidth", () => {
  it("keeps the value within bounds", () => {
    expect(clampWidth(500, 320, 900)).toBe(500);
    expect(clampWidth(100, 320, 900)).toBe(320);
    expect(clampWidth(1200, 320, 900)).toBe(900);
  });

  it("bounds are inclusive", () => {
    expect(clampWidth(320, 320, 900)).toBe(320);
    expect(clampWidth(900, 320, 900)).toBe(900);
  });

  it("NaN/Infinity → minimum", () => {
    expect(clampWidth(Number.NaN, 320, 900)).toBe(320);
    expect(clampWidth(Number.POSITIVE_INFINITY, 320, 900)).toBe(900);
    expect(clampWidth(Number.NEGATIVE_INFINITY, 320, 900)).toBe(320);
  });
});

describe("nextWidthFromDrag (right pane, handle on the left)", () => {
  it("dragging the handle left — the pane gets wider", () => {
    // start 400, cursor moved from x=1000 to x=900 (left by 100) → +100
    expect(nextWidthFromDrag(400, 1000, 900, 320, 900)).toBe(500);
  });

  it("dragging the handle right — the pane gets narrower", () => {
    // cursor from 1000 to 1100 (right by 100) → -100
    expect(nextWidthFromDrag(400, 1000, 1100, 320, 900)).toBe(320);
  });

  it("no movement — width doesn't change", () => {
    expect(nextWidthFromDrag(555, 1000, 1000, 320, 900)).toBe(555);
  });

  it("the result is clamped at the maximum", () => {
    expect(nextWidthFromDrag(880, 1000, 500, 320, 900)).toBe(900);
  });
});

describe("nextWidthFromDrag (left pane, handle on the right)", () => {
  it("dragging the handle right — the pane gets wider", () => {
    // cursor from 300 to 400 (right by 100) → +100
    expect(nextWidthFromDrag(280, 300, 400, 200, 520, "left")).toBe(380);
  });

  it("dragging the handle left — the pane gets narrower", () => {
    // cursor from 300 to 200 (left by 100) → -100
    expect(nextWidthFromDrag(280, 300, 200, 200, 520, "left")).toBe(200);
  });

  it("the sign is opposite the right pane for the same movement", () => {
    const drag = { start: 400, from: 1000, to: 900 };
    const right = nextWidthFromDrag(drag.start, drag.from, drag.to, 100, 900);
    const left = nextWidthFromDrag(drag.start, drag.from, drag.to, 100, 900, "left");
    expect(right).toBe(500); // +100
    expect(left).toBe(300); // -100
  });
});
