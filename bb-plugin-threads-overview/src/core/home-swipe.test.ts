import { describe, expect, it } from "vitest";
import {
  HOME_SWIPE_EDGE,
  HOME_SWIPE_SCROLL_SLACK,
  HOME_SWIPE_REACH,
  hasRoomBelow,
  reachesHome,
  startsHomeSwipe,
} from "./home-swipe";

const SCREEN = 800;

describe("startsHomeSwipe", () => {
  it("takes a finger that lands on the bottom edge", () => {
    expect(startsHomeSwipe({ x: 200, y: 780 }, SCREEN)).toBe(true);
  });

  it("leaves a finger that lands up the screen alone", () => {
    expect(startsHomeSwipe({ x: 200, y: 400 }, SCREEN)).toBe(false);
  });

  it("counts the edge from the screen it is given, not from a fixed line", () => {
    expect(startsHomeSwipe({ x: 200, y: 780 }, 2000)).toBe(false);
  });
});

describe("reachesHome", () => {
  it("goes home once the finger has gone far enough up", () => {
    expect(reachesHome({ x: 200, y: 780 }, { x: 200, y: 660 })).toBe(true);
  });

  it("waits while the finger has gone up only a little", () => {
    expect(reachesHome({ x: 200, y: 780 }, { x: 200, y: 760 })).toBe(false);
  });

  it("stays put for a drag that goes sideways more than up", () => {
    expect(reachesHome({ x: 200, y: 780 }, { x: 40, y: 680 })).toBe(false);
  });

  it("stays put for a finger going down", () => {
    expect(reachesHome({ x: 200, y: 600 }, { x: 200, y: 780 })).toBe(false);
  });
});

describe("the edges of the strip and the reach", () => {
  it("takes the topmost pixel of the strip", () => {
    expect(startsHomeSwipe({ x: 200, y: SCREEN - HOME_SWIPE_EDGE }, SCREEN)).toBe(true);
  });

  it("leaves the pixel just above the strip", () => {
    expect(startsHomeSwipe({ x: 200, y: SCREEN - HOME_SWIPE_EDGE - 1 }, SCREEN)).toBe(false);
  });

  it("goes home on the very pixel the reach asks for", () => {
    expect(reachesHome({ x: 0, y: SCREEN }, { x: 0, y: SCREEN - HOME_SWIPE_REACH })).toBe(true);
  });

  it("waits one pixel short of it", () => {
    expect(reachesHome({ x: 0, y: SCREEN }, { x: 0, y: SCREEN - HOME_SWIPE_REACH + 1 })).toBe(false);
  });

  it("gives a drag that climbs exactly as much as it wanders to nobody", () => {
    const up = HOME_SWIPE_REACH + 10;
    expect(reachesHome({ x: 0, y: SCREEN }, { x: up, y: SCREEN - up })).toBe(false);
  });
});

describe("hasRoomBelow", () => {
  it("sees room under a box scrolled partway", () => {
    expect(hasRoomBelow({ scrollTop: 100, clientHeight: 400, scrollHeight: 2000 })).toBe(true);
  });

  it("sees none in a box already at its bottom", () => {
    expect(hasRoomBelow({ scrollTop: 1600, clientHeight: 400, scrollHeight: 2000 })).toBe(false);
  });

  it("sees none in a box shorter than itself", () => {
    expect(hasRoomBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(false);
  });

  it("ignores the pixel of rounding a browser leaves behind", () => {
    expect(hasRoomBelow({ scrollTop: 1599.4, clientHeight: 400, scrollHeight: 2000 })).toBe(false);
  });
});

describe("the edge of the slack under a list", () => {
  it("counts the last pixels bb itself calls the bottom as no room at all", () => {
    expect(
      hasRoomBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 + HOME_SWIPE_SCROLL_SLACK }),
    ).toBe(false);
  });

  it("sees room one pixel past that", () => {
    expect(
      hasRoomBelow({
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 401 + HOME_SWIPE_SCROLL_SLACK,
      }),
    ).toBe(true);
  });
});
