// The edges of Home belong to edge gestures: a swipe to the right from the left
// edge opens bb's left panel, a swipe to the left from the right edge brings
// out the actions of the row under the finger, wherever on that line it landed.
import { describe, expect, it } from "vitest";
import {
  BB_SIDEBAR_SWIPE_FLOOR,
  PANEL_FLICK_SHARE,
  PANEL_FLICK_SPEED,
  PANEL_OPEN_SHARE,
  SIDEBAR_SWIPE_EDGE_SHARE,
  bbTakesSidebarSwipe,
  claimsPanelSwipe,
  claimsSidebarSwipe,
  edgeStrip,
  intoBbSidebarSwipe,
  opensPanel,
  panelProgress,
  rowAt,
} from "./edge-swipe";
import type { Point } from "./home-swipe";

const WIDTH = 400;
const START: Point = { x: 4, y: 300 };
const by = (dx: number, dy: number): Point => ({ x: START.x + dx, y: START.y + dy });

describe("edgeStrip", () => {
  it("gives the left 15% of the screen to the left panel", () => {
    expect(SIDEBAR_SWIPE_EDGE_SHARE).toBe(0.15);
    for (const x of [0, 1, 30, WIDTH * 0.15 - 1]) expect(edgeStrip(x, WIDTH)).toBe("sidebar");
  });

  it("gives the right 15% of the screen to the rows, out to its very last pixel", () => {
    for (const x of [WIDTH * 0.85, WIDTH - 1, WIDTH]) expect(edgeStrip(x, WIDTH)).toBe("row");
  });

  it("leaves the middle to the project slides", () => {
    for (const x of [WIDTH * 0.15, WIDTH / 2, WIDTH * 0.85 - 1]) expect(edgeStrip(x, WIDTH)).toBeNull();
  });
});

describe("bbTakesSidebarSwipe", () => {
  it("leaves the strip nearest the edge to this plugin, the rest to bb's own swipe", () => {
    expect(bbTakesSidebarSwipe(0)).toBe(false);
    expect(bbTakesSidebarSwipe(BB_SIDEBAR_SWIPE_FLOOR - 1)).toBe(false);
    expect(bbTakesSidebarSwipe(BB_SIDEBAR_SWIPE_FLOOR)).toBe(true);
  });
});

describe("claimsSidebarSwipe", () => {
  it("keeps a move to the right from the first pixel", () => {
    expect(claimsSidebarSwipe(START, by(1, 0))).toBe(true);
    expect(claimsSidebarSwipe(START, by(40, -30))).toBe(true);
  });

  it("leaves a move to the left to the slides and an upright one to the page", () => {
    expect(claimsSidebarSwipe(START, by(-10, 0))).toBe(false);
    expect(claimsSidebarSwipe(START, by(10, 30))).toBe(false);
    expect(claimsSidebarSwipe(START, by(0, 0))).toBe(false);
  });
});

describe("intoBbSidebarSwipe", () => {
  it("puts a finger landed nearer the edge than bb listens right on bb's floor", () => {
    for (const x of [0, 4, BB_SIDEBAR_SWIPE_FLOOR - 1]) {
      const start = { x, y: 300 };
      expect(intoBbSidebarSwipe(start, start)).toEqual({ x: BB_SIDEBAR_SWIPE_FLOOR, y: 300 });
    }
  });

  it("carries every later point by the same shift, so the panel moves exactly as far as the finger", () => {
    for (const [dx, dy] of [[1, 0], [40, -30], [-10, 5], [200, 0]] as const) {
      const shifted = intoBbSidebarSwipe(START, by(dx, dy));
      const origin = intoBbSidebarSwipe(START, START);
      expect({ dx: shifted.x - origin.x, dy: shifted.y - origin.y }).toEqual({ dx, dy });
    }
  });

  it("leaves a finger bb already takes where it is", () => {
    const start = { x: BB_SIDEBAR_SWIPE_FLOOR, y: 300 };
    expect(intoBbSidebarSwipe(start, { x: 90, y: 280 })).toEqual({ x: 90, y: 280 });
  });
});

describe("rowAt", () => {
  const rows = [
    { top: 100, bottom: 144 },
    { top: 144, bottom: 188 },
  ];

  it("finds the row on the finger's line", () => {
    expect(rowAt(rows, 100)).toBe(0);
    expect(rowAt(rows, 143)).toBe(0);
    expect(rowAt(rows, 144)).toBe(1);
  });

  it("finds none above, below or with no rows at all", () => {
    expect(rowAt(rows, 99)).toBeNull();
    expect(rowAt(rows, 188)).toBeNull();
    expect(rowAt([], 120)).toBeNull();
  });
});

describe("claimsPanelSwipe", () => {
  const from: Point = { x: 390, y: 300 };
  const to = (dx: number, dy: number): Point => ({ x: from.x + dx, y: from.y + dy });

  it("keeps a move more to the left than upright from the page, from the first pixel", () => {
    expect(claimsPanelSwipe(from, to(-1, 0))).toBe(true);
    expect(claimsPanelSwipe(from, to(-30, 29))).toBe(true);
  });

  it("leaves a move to the right, an upright one and no move at all to the page", () => {
    expect(claimsPanelSwipe(from, to(10, 0))).toBe(false);
    expect(claimsPanelSwipe(from, to(-10, -10))).toBe(false);
    expect(claimsPanelSwipe(from, from)).toBe(false);
  });
});

describe("panelProgress", () => {
  const from: Point = { x: 390, y: 300 };

  it("grows with the pull to the left, as a share of the width", () => {
    expect(panelProgress(from, { x: 290, y: 300 }, 400)).toBe(0.25);
  });

  it("stays between 0 and 1", () => {
    expect(panelProgress(from, { x: 395, y: 300 }, 400)).toBe(0);
    expect(panelProgress(from, { x: -100, y: 300 }, 400)).toBe(1);
    expect(panelProgress(from, { x: 0, y: 300 }, 0)).toBe(0);
  });
});

describe("opensPanel", () => {
  it("opens past a third of the screen, however slow", () => {
    expect(opensPanel(PANEL_OPEN_SHARE, 0)).toBe(true);
    expect(opensPanel(PANEL_OPEN_SHARE - 0.01, 0)).toBe(false);
  });

  it("opens a quick flick to the left from a short pull", () => {
    expect(opensPanel(PANEL_FLICK_SHARE, -PANEL_FLICK_SPEED)).toBe(true);
    expect(opensPanel(PANEL_FLICK_SHARE, -PANEL_FLICK_SPEED + 1)).toBe(false);
    expect(opensPanel(PANEL_FLICK_SHARE - 0.01, -1000)).toBe(false);
  });

  it("does not open a short pull flying back to the right", () => {
    expect(opensPanel(0.2, 1000)).toBe(false);
  });
});
