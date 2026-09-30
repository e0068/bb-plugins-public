// Where bb's composer is held on the carried card: its bottom on the bottom of
// the conversation, as far above it as it stood on the flat screen, whatever
// the conversation under it has done since and however small the card is.
import { describe, expect, it } from "vitest";
import { heldTop } from "./sticky-hold";

describe("heldTop", () => {
  it("leaves a box standing where it should alone", () => {
    expect(heldTop({ top: -12, bottom: 900, floor: 900, gap: 0, scale: 1 })).toBe(-12);
  });

  it("brings a box the conversation carried up back down to its floor", () => {
    expect(heldTop({ top: -12, bottom: 850, floor: 900, gap: 0, scale: 1 })).toBe(38);
  });

  it("brings a box the conversation carried down back up to its floor", () => {
    expect(heldTop({ top: -12, bottom: 960, floor: 900, gap: 0, scale: 1 })).toBe(-72);
  });

  it("counts the way back in the box's own pixels, not the shrunk card's", () => {
    expect(heldTop({ top: 0, bottom: 883, floor: 900, gap: 0, scale: 0.85 })).toBeCloseTo(20);
  });

  it("keeps the box as far above its floor as it stood on the flat screen", () => {
    expect(heldTop({ top: 0, bottom: 900, floor: 900, gap: 16, scale: 1 })).toBe(-16);
    expect(heldTop({ top: 0, bottom: 900 - 16 * 0.85, floor: 900, gap: 16, scale: 0.85 })).toBeCloseTo(0);
  });

  it("leaves the box alone on a screen with no size to measure by", () => {
    expect(heldTop({ top: -12, bottom: 850, floor: 900, gap: 0, scale: 0 })).toBe(-12);
  });
});

describe("heldTop, over any box and any card", () => {
  it("stands the box's bottom as far above its floor as it stood, in the card's pixels", () => {
    const tops = [-120, -12, 0, 40];
    const bottoms = [300, 850, 900, 960];
    const gaps = [0, 16, 48];
    const scales = [0.85, 0.9, 1];
    for (const top of tops)
      for (const bottom of bottoms)
        for (const gap of gaps)
          for (const scale of scales) {
            const floor = 900;
            const next = heldTop({ top, bottom, floor, gap, scale });
            // The box moves on the screen by its change of offset, shrunk by the card.
            expect(bottom + (next - top) * scale).toBeCloseTo(floor - gap * scale);
          }
  });
});
