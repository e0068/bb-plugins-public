// How the thread screen looks while a finger carries it home: lifted with the
// finger, shrinking to a card, rounding its corners, and armed exactly when
// letting go would go home.
import { describe, expect, it } from "vitest";
import {
  HOME_SWIPE_CARD_SHADE,
  HOME_SWIPE_DEAD_ZONE,
  reachesHome,
  swipeCard,
  type Point,
} from "./home-swipe";

const START: Point = { x: 200, y: 780 };
const up = (by: number, sideways = 0): Point => ({ x: START.x + sideways, y: START.y - by });

describe("swipeCard", () => {
  it("lifts the screen as far as the finger has gone up", () => {
    expect(swipeCard(START, up(50)).lift).toBe(50);
  });

  it("shrinks the screen as the finger climbs, and never below a card", () => {
    const scales = [0, 20, 60, 120, 240, 400, 800].map((by) => swipeCard(START, up(by)).scale);
    scales.slice(1).forEach((scale, i) => expect(scale).toBeLessThanOrEqual(scales[i]!));
    scales.forEach((scale) => {
      expect(scale).toBeGreaterThanOrEqual(0.85);
      expect(scale).toBeLessThanOrEqual(1);
    });
    expect(swipeCard(START, up(240)).scale).toBeCloseTo(0.85);
    expect(swipeCard(START, up(800)).scale).toBeCloseTo(0.85);
  });

  it("rounds the corners up to 24 px by the time letting go would go home", () => {
    expect(swipeCard(START, up(40)).radius).toBeGreaterThan(0);
    expect(swipeCard(START, up(40)).radius).toBeLessThan(24);
    expect(swipeCard(START, up(80)).radius).toBe(24);
    expect(swipeCard(START, up(300)).radius).toBe(24);
  });

  it("is armed exactly when letting go would go home", () => {
    const moves = [up(0), up(79), up(80), up(200), up(100, 150), up(100, -99), { x: 200, y: 799 }];
    moves.forEach((now) => expect(swipeCard(START, now).armed).toBe(reachesHome(START, now)));
  });
});

const FLAT = { lift: 0, scale: 1, radius: 0, shade: 0, armed: false, holds: false };

describe("swipeCard, flat and held", () => {
  it("leaves the screen flat before the finger moves", () => {
    expect(swipeCard(START, START)).toEqual(FLAT);
  });

  it("leaves the screen flat for a finger going down", () => {
    expect(swipeCard(START, { x: 200, y: 799 })).toEqual(FLAT);
  });

  it("leaves the screen flat, and the page its move, while the finger is still in the dead zone", () => {
    expect(swipeCard(START, up(HOME_SWIPE_DEAD_ZONE - 1))).toEqual(FLAT);
  });

  it("holds the page once the finger has climbed out of the dead zone", () => {
    const card = swipeCard(START, up(HOME_SWIPE_DEAD_ZONE));
    expect(card.holds).toBe(true);
    expect(card.lift).toBe(HOME_SWIPE_DEAD_ZONE);
  });

  it("lays the screen flat and gives the page back a drag that has wandered sideways", () => {
    expect(swipeCard(START, up(100, 150))).toEqual(FLAT);
    expect(swipeCard(START, up(100, -100))).toEqual(FLAT);
  });

  it("shades the world around the card in step with its shrinking, up to the full shade", () => {
    const shades = [8, 20, 60, 120, 240, 400].map((by) => swipeCard(START, up(by)).shade);
    shades.slice(1).forEach((shade, i) => expect(shade).toBeGreaterThanOrEqual(shades[i]!));
    expect(swipeCard(START, up(240)).shade).toBeCloseTo(HOME_SWIPE_CARD_SHADE);
    expect(swipeCard(START, up(800)).shade).toBeCloseTo(HOME_SWIPE_CARD_SHADE);
  });
});
