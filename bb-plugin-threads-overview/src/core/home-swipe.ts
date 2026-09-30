// Pure rule for the gesture that leaves a thread: a finger put down at the
// bottom edge of the screen and pushed up takes the screen home, the way a
// phone sends an app away. Layer 1: depends only on the box.

import type { Box } from "./box";

/** A point under the finger, in the screen's own coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How tall the strip along the bottom edge is where the gesture may start, in px. */
export const HOME_SWIPE_EDGE = 96;

/** How far up the finger travels before the screen goes home, in px. */
export const HOME_SWIPE_REACH = 80;

/**
 * Whether a finger landing here can start the gesture at all. The strip is
 * measured from the screen's own height, so it stays a strip on a phone held
 * either way and on a window of any size.
 */
export function startsHomeSwipe(start: Point, screenHeight: number): boolean {
  return start.y >= screenHeight - HOME_SWIPE_EDGE;
}

/** What a box says about its own scrolling — an element answers this shape as it is. */
export interface ScrollBox {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

/**
 * How many pixels short of the end still count as the end, in px. Four,
 * because that is the slack bb's own shell uses to decide a conversation sits
 * at its newest message: a thread bb calls "at the bottom" has to be one the
 * gesture calls that too, or the swipe would quietly do nothing.
 */
export const HOME_SWIPE_SCROLL_SLACK = 4;

/**
 * Whether a box still has content below what it shows. A finger pushed up over
 * such a box is asking it to scroll, not asking for the home screen, so the
 * gesture stays out of its way; a conversation resting at its newest message
 * has no room left and lets the gesture through.
 */
export function hasRoomBelow(box: ScrollBox): boolean {
  return box.scrollHeight - box.clientHeight - box.scrollTop > HOME_SWIPE_SCROLL_SLACK;
}

/**
 * Whether the finger has gone far enough, and upright enough, to go home. A
 * drag that wanders sideways more than it climbs is somebody else's gesture —
 * a row's swipe, a slide of project groups — and is left to them.
 */
export function reachesHome(start: Point, now: Point): boolean {
  const up = start.y - now.y;
  return up >= HOME_SWIPE_REACH && up > Math.abs(now.x - start.x);
}

/**
 * How far up the finger climbs before the screen is carried at all, in px: a
 * tap on the composer or its send button wobbles a pixel or two, and must not
 * stir the screen. The page is held all the same — see `claimsMove`.
 */
export const HOME_SWIPE_DEAD_ZONE = 8;

/** How far up the finger carries the screen before it has shrunk all the way to a card, in px. */
export const HOME_SWIPE_CARD_TRAVEL = 240;

/** How small the card gets: the screen never shrinks past this share of itself. */
export const HOME_SWIPE_CARD_SCALE = 0.85;

/** How round the card's corners get, in px — reached right where letting go goes home. */
export const HOME_SWIPE_CARD_RADIUS = 24;

/** How dark the shadow the card casts gets once it has shrunk all the way, from 0 to 1. */
export const HOME_SWIPE_CARD_SHADE = 0.55;

/** How the thread screen looks while a finger carries it home. */
export interface SwipeCard {
  /** How far the screen is lifted with the finger, in px; never below 0. */
  readonly lift: number;
  /** How large the screen is against itself, from 1 down to `HOME_SWIPE_CARD_SCALE`. */
  readonly scale: number;
  /** How round its corners are, in px, from 0 up to `HOME_SWIPE_CARD_RADIUS`. */
  readonly radius: number;
  /** How dark the shadow it casts is, from 0 up to `HOME_SWIPE_CARD_SHADE`. */
  readonly shade: number;
  /** Letting go right here goes home — the same answer `reachesHome` gives. */
  readonly armed: boolean;
  /** The finger is carrying the screen. */
  readonly holds: boolean;
}

const FLAT_CARD: SwipeCard = { lift: 0, scale: 1, radius: 0, shade: 0, armed: false, holds: false };

/**
 * The screen under a finger that has gone from `start` to `now`. Out of the
 * dead zone and upright — more up than sideways — it follows the finger up,
 * shrinks towards a card and casts a deepening shadow over
 * `HOME_SWIPE_CARD_TRAVEL`, and its corners are fully round by the reach, so
 * the look says "let go now" exactly when letting go would go home. A finger
 * gone down, barely moved or wandered sideways leaves the screen flat; whether
 * the page gets the move is `claimsMove`'s to say.
 */
export function swipeCard(start: Point, now: Point): SwipeCard {
  const up = start.y - now.y;
  if (up < HOME_SWIPE_DEAD_ZONE || up <= Math.abs(now.x - start.x)) return FLAT_CARD;
  const travel = Math.min(up, HOME_SWIPE_CARD_TRAVEL) / HOME_SWIPE_CARD_TRAVEL;
  return {
    lift: up,
    scale: 1 - (1 - HOME_SWIPE_CARD_SCALE) * travel,
    radius: HOME_SWIPE_CARD_RADIUS * (Math.min(up, HOME_SWIPE_REACH) / HOME_SWIPE_REACH),
    shade: HOME_SWIPE_CARD_SHADE * travel,
    armed: reachesHome(start, now),
    holds: true,
  };
}

/**
 * Whether a move of a finger that started the gesture is kept from the page.
 * Everything upright is, the climb inside the dead zone and a dip back into it
 * included: iOS hands the whole touch to a scroll, or to the bounce of a list
 * already at its end, the moment it sees one move nobody stopped, and every
 * move after that comes too late to stop. The card still waits for the dead
 * zone; only the page is told to hold. A finger going down or sideways more
 * than up is the page's.
 */
export function claimsMove(start: Point, now: Point): boolean {
  return start.y - now.y > Math.abs(now.x - start.x);
}

/** Where a composer stands on the screen: its left edge, width and gap above the bottom edge, in px. */
export interface ComposerBox {
  readonly left: number;
  readonly width: number;
  readonly bottom: number;
}

/**
 * Where to stand the composer held under the card, from the box bb's own
 * composer had on Home: same left edge and width, the same gap above the
 * bottom of the screen. A composer that ran past the bottom edge rests on it.
 */
export function composerBox(
  rect: { readonly left: number; readonly width: number; readonly bottom: number },
  viewportHeight: number,
): ComposerBox {
  return { left: rect.left, width: rect.width, bottom: Math.max(0, viewportHeight - rect.bottom) };
}

/**
 * Where to stand the section under the card, from the box it had on Home and
 * the top of Home's composer, if one was seen. Home's list scrolls on under
 * bb's composer block, which covers it down to the bottom edge; under the
 * card that block is not drawn, so the list ends where the composer begins.
 * Read field by field: a DOMRect's sides are getters, which a spread drops.
 */
export function sectionAboveComposer(
  { top, left, width, height }: Box,
  composerTop: number | null,
): Box {
  const shown = composerTop === null ? height : Math.max(0, Math.min(height, composerTop - top));
  return { top, left, width, height: shown };
}
