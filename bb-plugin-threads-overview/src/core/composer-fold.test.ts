// The rule for folding bb's composer with a finger: pulled down, it shrinks
// with the finger, and let go far enough down it folds to one line.
import { describe, expect, it } from "vitest";
import {
  COMPOSER_FOLDED_HEIGHT,
  COMPOSER_FOLD_DEAD_ZONE,
  COMPOSER_FOLD_REACH,
  canFold,
  claimsFold,
  foldDrag,
  scrollsDraftBack,
} from "./composer-fold";
import type { Point } from "./home-swipe";

const START: Point = { x: 200, y: 600 };
const down = (by: number, sideways = 0): Point => ({ x: START.x + sideways, y: START.y + by });
const FULL = 180;

describe("canFold", () => {
  it("folds a composer taller than one line", () => {
    expect(canFold(FULL, false)).toBe(true);
  });

  it("leaves a composer already one line tall and not typed into alone", () => {
    expect(canFold(COMPOSER_FOLDED_HEIGHT, false)).toBe(false);
    expect(canFold(COMPOSER_FOLDED_HEIGHT - 10, false)).toBe(false);
  });

  it("folds a composer being typed into however short it is: the keyboard is the thing to put away", () => {
    expect(canFold(COMPOSER_FOLDED_HEIGHT, true)).toBe(true);
  });
});

describe("scrollsDraftBack", () => {
  it("leaves a pull down to a draft scrolled past its first line", () => {
    expect(scrollsDraftBack({ scrollTop: 120 })).toBe(true);
  });

  it("takes a pull down over a draft resting at its first line", () => {
    expect(scrollsDraftBack({ scrollTop: 0 })).toBe(false);
    expect(scrollsDraftBack({ scrollTop: 2 })).toBe(false);
  });
});

describe("claimsFold", () => {
  it("keeps every move that goes more down than sideways from the page, the first pixel included", () => {
    expect(claimsFold(START, down(1))).toBe(true);
    expect(claimsFold(START, down(60, 20))).toBe(true);
  });

  it("leaves a move up, a sideways one and a finger at rest to the page", () => {
    expect(claimsFold(START, down(-30))).toBe(false);
    expect(claimsFold(START, down(20, 40))).toBe(false);
    expect(claimsFold(START, down(0))).toBe(false);
  });
});

describe("foldDrag", () => {
  it("leaves the composer whole in the dead zone and for a sideways or upward move", () => {
    const whole = { height: FULL, armed: false, holds: false };
    expect(foldDrag(START, down(COMPOSER_FOLD_DEAD_ZONE - 1), FULL)).toEqual(whole);
    expect(foldDrag(START, down(40, 60), FULL)).toEqual(whole);
    expect(foldDrag(START, down(-40), FULL)).toEqual(whole);
  });

  it("shrinks the composer by exactly as far as the finger has gone down", () => {
    expect(foldDrag(START, down(COMPOSER_FOLD_DEAD_ZONE), FULL).height).toBe(FULL - COMPOSER_FOLD_DEAD_ZONE);
    expect(foldDrag(START, down(50), FULL)).toMatchObject({ height: FULL - 50, holds: true });
  });

  it("never shrinks it below one line", () => {
    expect(foldDrag(START, down(400), FULL).height).toBe(COMPOSER_FOLDED_HEIGHT);
  });

  it("folds on letting go from the reach on, and not a pixel before", () => {
    expect(foldDrag(START, down(COMPOSER_FOLD_REACH - 1), FULL).armed).toBe(false);
    expect(foldDrag(START, down(COMPOSER_FOLD_REACH), FULL).armed).toBe(true);
  });

  it("reaches the fold within the composer's own height, however short it is", () => {
    const short = COMPOSER_FOLDED_HEIGHT + 10;
    expect(foldDrag(START, down(10), short).armed).toBe(true);
    expect(foldDrag(START, down(9), short).armed).toBe(false);
  });

  it("puts a composer with nothing left to shrink away on the reach", () => {
    expect(foldDrag(START, down(COMPOSER_FOLD_REACH - 1), COMPOSER_FOLDED_HEIGHT).armed).toBe(false);
    expect(foldDrag(START, down(COMPOSER_FOLD_REACH), COMPOSER_FOLDED_HEIGHT).armed).toBe(true);
  });
});

describe("foldDrag on a composer shorter than one line", () => {
  it("never makes it taller than it stands", () => {
    const short = COMPOSER_FOLDED_HEIGHT - 8;
    expect(foldDrag(START, down(30), short).height).toBe(short);
  });
});
