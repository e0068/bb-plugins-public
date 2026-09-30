import { describe, expect, it } from "vitest";
import {
  HOME_SWIPE_DEAD_ZONE,
  HOME_SWIPE_EDGE,
  HOME_SWIPE_SCROLL_SLACK,
  HOME_SWIPE_REACH,
  claimsMove,
  composerBox,
  hasRoomBelow,
  reachesHome,
  startsHomeSwipe,
  swipeCard,
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

describe("claimsMove", () => {
  it("claims a finger that starts to climb, even inside the dead zone", () => {
    expect(claimsMove({ x: 200, y: 780 }, { x: 200, y: 779 })).toBe(true);
  });

  it("leaves a finger going down to the page", () => {
    expect(claimsMove({ x: 200, y: 780 }, { x: 200, y: 781 })).toBe(false);
  });

  it("leaves a finger going sideways more than up to the page", () => {
    expect(claimsMove({ x: 200, y: 780 }, { x: 205, y: 778 })).toBe(false);
  });

  it("claims every move the card itself follows", () => {
    for (const up of [HOME_SWIPE_DEAD_ZONE, HOME_SWIPE_REACH, 400]) {
      const start = { x: 200, y: 780 };
      const now = { x: 205, y: 780 - up };
      expect(swipeCard(start, now).holds).toBe(true);
      expect(claimsMove(start, now)).toBe(true);
    }
  });
});

describe("composerBox", () => {
  const VIEWPORT = 800;
  const rects = [
    { left: 0, width: 390, bottom: 800 },
    { left: 12, width: 366, bottom: 776 },
    { left: 40, width: 700, bottom: 500 },
    { left: 0, width: 390, bottom: 812 },
  ];

  it("keeps the composer's left edge and width as they stood on Home", () => {
    for (const rect of rects) {
      const box = composerBox(rect, VIEWPORT);
      expect([box.left, box.width]).toEqual([rect.left, rect.width]);
    }
  });

  it("measures the gap from the bottom of the screen, never below zero", () => {
    for (const rect of rects) {
      expect(composerBox(rect, VIEWPORT).bottom).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives the gap that stood between the composer and the bottom edge", () => {
    expect(composerBox({ left: 12, width: 366, bottom: 776 }, VIEWPORT).bottom).toBe(24);
  });

  it("sets a composer resting on the very bottom edge at zero", () => {
    expect(composerBox({ left: 0, width: 390, bottom: 800 }, VIEWPORT).bottom).toBe(0);
  });

  it("sets a composer overflowing the bottom edge at zero, not below", () => {
    expect(composerBox({ left: 0, width: 390, bottom: 812 }, VIEWPORT).bottom).toBe(0);
  });
});
