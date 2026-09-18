import { describe, expect, it } from "vitest";
import { holdsGesture, swipeAxis, swipeOffset, swipeSettlesOpen } from "./swipe";

describe("swipeAxis", () => {
  it("waits until the finger has moved past the slop", () => {
    expect(swipeAxis(4, 3)).toBe("undecided");
  });

  it("takes a mostly sideways move as a swipe", () => {
    expect(swipeAxis(-20, 6)).toBe("horizontal");
  });

  it("leaves a mostly upright move to the page scroll", () => {
    expect(swipeAxis(-6, 20)).toBe("vertical");
  });
});

describe("swipeOffset", () => {
  it("follows the finger to the left from a closed row", () => {
    expect(swipeOffset(false, -30, 96)).toBe(-30);
  });

  it("stops at the width of the actions", () => {
    expect(swipeOffset(false, -300, 96)).toBe(-96);
  });

  it("never slides to the right of its resting place", () => {
    expect(swipeOffset(false, 40, 96)).toBe(0);
  });

  it("starts from the open position when the row is already open", () => {
    expect(swipeOffset(true, 30, 96)).toBe(-66);
  });
});

describe("swipeSettlesOpen", () => {
  it("opens once the row is dragged past half of the actions", () => {
    expect(swipeSettlesOpen(false, -60, 96)).toBe(true);
  });

  it("springs back when dragged less than half", () => {
    expect(swipeSettlesOpen(false, -40, 96)).toBe(false);
  });

  it("closes an open row pushed back past half", () => {
    expect(swipeSettlesOpen(true, 60, 96)).toBe(false);
  });
});

describe("holdsGesture", () => {
  it("holds a drag that has gone sideways", () => {
    expect(holdsGesture("horizontal", true)).toBe(true);
  });

  it("lets an upright drag go to the page", () => {
    expect(holdsGesture("vertical", true)).toBe(false);
  });

  it("lets a drag that has not made up its mind go", () => {
    expect(holdsGesture("undecided", true)).toBe(false);
  });

  it("holds nothing once the move can no longer be stopped", () => {
    expect(holdsGesture("horizontal", false)).toBe(false);
  });
});
