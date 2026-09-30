// Where a pull on the composer starts decides what it folds: from the body —
// the draft and what sits above the buttons — the composer and the keyboard
// together; from the panel — the row of buttons and what lies under the
// composer — the keyboard alone. And an open composer holds a push up to
// itself, so the page under it does not shake.
import { describe, expect, it } from "vitest";
import {
  COMPOSER_FOLD_REACH,
  composerOpen,
  dismissesKeyboard,
  foldZone,
  holdsOpenComposer,
} from "./composer-fold";
import type { Point } from "./home-swipe";

const START: Point = { x: 200, y: 600 };
const by = (dx: number, dy: number): Point => ({ x: START.x + dx, y: START.y + dy });

describe("foldZone", () => {
  it("reads the row of buttons as the panel", () => {
    expect(foldZone({ inActionRow: true, inForm: true })).toBe("panel");
  });

  it("reads what lies under the form, still inside the composer, as the panel", () => {
    expect(foldZone({ inActionRow: false, inForm: false })).toBe("panel");
  });

  it("reads the rest of the form as the body", () => {
    expect(foldZone({ inActionRow: false, inForm: true })).toBe("body");
  });
});

describe("dismissesKeyboard", () => {
  it("puts the keyboard away once the finger has gone the reach down", () => {
    expect(dismissesKeyboard(START, by(0, COMPOSER_FOLD_REACH))).toBe(true);
    expect(dismissesKeyboard(START, by(10, COMPOSER_FOLD_REACH + 40))).toBe(true);
  });

  it("keeps the keyboard short of the reach", () => {
    expect(dismissesKeyboard(START, by(0, COMPOSER_FOLD_REACH - 1))).toBe(false);
  });

  it("keeps the keyboard for a finger gone up or more sideways than down", () => {
    expect(dismissesKeyboard(START, by(0, -COMPOSER_FOLD_REACH * 2))).toBe(false);
    expect(dismissesKeyboard(START, by(COMPOSER_FOLD_REACH * 2, COMPOSER_FOLD_REACH))).toBe(false);
  });
});

describe("holdsOpenComposer", () => {
  it("holds a push more up than sideways, from its first pixel", () => {
    expect(holdsOpenComposer(START, by(0, -1))).toBe(true);
    expect(holdsOpenComposer(START, by(10, -40))).toBe(true);
  });

  it("leaves a pull down, a sideways move and a finger at rest alone", () => {
    for (const [dx, dy] of [[0, 1], [0, 40], [40, -10], [0, 0]] as const) {
      expect(holdsOpenComposer(START, by(dx, dy))).toBe(false);
    }
  });
});

describe("composerOpen", () => {
  it("calls a composer open that is neither folded nor drawn compact", () => {
    expect(composerOpen({ folded: false, compact: false })).toBe(true);
  });

  it("calls a folded or compact composer closed", () => {
    expect(composerOpen({ folded: true, compact: false })).toBe(false);
    expect(composerOpen({ folded: false, compact: true })).toBe(false);
    expect(composerOpen({ folded: true, compact: true })).toBe(false);
  });
});
