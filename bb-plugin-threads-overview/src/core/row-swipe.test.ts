// Where a sideways swipe over the queue starts decides whose it is: from the
// right edge it brings out a row's actions, from anywhere else it turns the
// project slides.
import { describe, expect, it } from "vitest";
import { ROW_SWIPE_EDGE_SHARE, claimsRowSwipe, startsRowSwipe } from "./swipe";
import type { Point } from "./home-swipe";

const WIDTH = 400;
const EDGE = WIDTH * (1 - ROW_SWIPE_EDGE_SHARE);
const START: Point = { x: EDGE + 20, y: 300 };
const by = (dx: number, dy: number, from: Point = START): Point => ({ x: from.x + dx, y: from.y + dy });

describe("startsRowSwipe", () => {
  it("takes a finger put down on the right 15% of the screen", () => {
    expect(ROW_SWIPE_EDGE_SHARE).toBe(0.15);
    expect(startsRowSwipe(EDGE, WIDTH)).toBe(true);
    expect(startsRowSwipe(WIDTH - 1, WIDTH)).toBe(true);
  });

  it("leaves a finger put down anywhere left of that strip to the project slides", () => {
    for (const x of [0, 1, WIDTH / 2, EDGE - 1]) expect(startsRowSwipe(x, WIDTH)).toBe(false);
  });

  it("measures the strip from the screen it is given, whatever its width", () => {
    expect(startsRowSwipe(700, 1000)).toBe(false);
    expect(startsRowSwipe(860, 1000)).toBe(true);
  });
});

describe("claimsRowSwipe", () => {
  it("keeps a closed row's swipe to the left, from its first pixel", () => {
    expect(claimsRowSwipe(START, by(-1, 0), false)).toBe(true);
    expect(claimsRowSwipe(START, by(-40, 10), false)).toBe(true);
  });

  it("gives a closed row's swipe to the right back to the slides", () => {
    expect(claimsRowSwipe(START, by(1, 0), false)).toBe(false);
    expect(claimsRowSwipe(START, by(40, 5), false)).toBe(false);
  });

  it("keeps an open row's swipe either way, so it can be closed by a swipe to the right", () => {
    expect(claimsRowSwipe(START, by(40, 5), true)).toBe(true);
    expect(claimsRowSwipe(START, by(-40, 5), true)).toBe(true);
  });

  it("never keeps a move more upright than sideways: that is the page's scroll", () => {
    for (const open of [false, true]) {
      for (const [dx, dy] of [[0, 10], [-5, 10], [5, -10], [-10, -10], [0, 0]] as const) {
        expect(claimsRowSwipe(START, by(dx, dy), open)).toBe(false);
      }
    }
  });
});
