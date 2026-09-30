import { describe, expect, it } from "vitest";
import { SCREEN_CLIP, rowClip } from "./thread-open";

const SCREEN = { width: 390, height: 800 };

/** The four insets of a clip, in px, top, right, bottom, left. */
function insets(clip: string): number[] {
  return [...clip.matchAll(/(-?\d+(?:\.\d+)?)px/g)].slice(0, 4).map((match) => Number(match[1]));
}

// A layer over the whole screen shows only the row's box at first, then
// opens out to the screen: the row grows into the thread.
describe("rowClip", () => {
  it("shows exactly the row's box of a layer over the screen", () => {
    expect(insets(rowClip({ top: 300, left: 16, width: 358, height: 60 }, SCREEN))).toEqual([300, 16, 440, 16]);
  });

  it("is the whole screen for a row that fills it", () => {
    expect(insets(rowClip({ top: 0, left: 0, width: 390, height: 800 }, SCREEN))).toEqual(insets(SCREEN_CLIP));
  });

  it("never clips past the screen's edges, for a row scrolled partly out of sight", () => {
    const rows = [
      { top: -30, left: 0, width: 390, height: 60 },
      { top: 780, left: 0, width: 390, height: 60 },
      { top: 100, left: -8, width: 420, height: 60 },
    ];
    for (const row of rows) {
      for (const inset of insets(rowClip(row, SCREEN))) expect(inset).toBeGreaterThanOrEqual(0);
    }
  });

  it("rounds the row's corners and not the screen's", () => {
    expect(rowClip({ top: 300, left: 16, width: 358, height: 60 }, SCREEN)).toMatch(/round [1-9]\d*px/);
    expect(SCREEN_CLIP).toMatch(/round 0px/);
  });
});
