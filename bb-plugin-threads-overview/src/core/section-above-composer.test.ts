import { describe, expect, it } from "vitest";
import { sectionAboveComposer } from "./home-swipe";

// Home's list scrolls on under bb's composer block, which covers it from the
// composer's top down to the bottom edge. Under the card that block is not
// drawn, so the list has to stop where it began.
describe("sectionAboveComposer", () => {
  const section = { top: 56, left: 0, width: 390, height: 1800 };

  it("ends the section where the composer on Home begins", () => {
    const box = sectionAboveComposer(section, 500);
    expect(box.top + box.height).toBe(500);
  });

  it("keeps the section's own top, left edge and width", () => {
    const box = sectionAboveComposer(section, 500);
    expect([box.top, box.left, box.width]).toEqual([56, 0, 390]);
  });

  it("keeps a section that ends above the composer as it was", () => {
    expect(sectionAboveComposer({ ...section, height: 300 }, 500).height).toBe(300);
  });

  it("keeps the section whole when no composer was seen", () => {
    expect(sectionAboveComposer(section, null).height).toBe(1800);
  });

  it("never gives a section a height below zero, the composer standing above its top", () => {
    for (const composerTop of [56, 40, 0, -10]) {
      expect(sectionAboveComposer(section, composerTop).height).toBe(0);
    }
  });
});

describe("sectionAboveComposer on a box read off the page", () => {
  it("keeps the box of a rect whose sides are getters, as a DOMRect's are", () => {
    class Rect {
      get top() { return 56; }
      get left() { return 0; }
      get width() { return 390; }
      get height() { return 1800; }
    }
    expect(sectionAboveComposer(new Rect(), 500)).toEqual({ top: 56, left: 0, width: 390, height: 444 });
  });
});
