// Pure rule for folding bb's composer with a finger: pulled down, the composer
// shrinks with the finger, and let go far enough down it folds to one line and
// the keyboard goes away; let go short of that, it stands back up. Layer 1:
// depends on nothing but the shape of a point.
import type { Point } from "./home-swipe";

/** How tall the composer is folded to one line, in px: the line of text and the send button beside it. */
export const COMPOSER_FOLDED_HEIGHT = 48;

/** How far down the finger goes before the composer starts to shrink, in px: a tap wobbles a pixel or two. */
export const COMPOSER_FOLD_DEAD_ZONE = 8;

/** How far down the finger goes before letting go folds the composer, in px. */
export const COMPOSER_FOLD_REACH = 56;

/** How many pixels a draft may be scrolled and still count as resting at its first line. */
const DRAFT_SCROLL_SLACK = 4;

/**
 * Whether a finger on the composer has anything to fold: a composer taller than
 * one line has, and so does one being typed into, whose keyboard is the thing
 * to put away.
 */
export function canFold(height: number, focused: boolean): boolean {
  return focused || height > COMPOSER_FOLDED_HEIGHT;
}

/**
 * Whether the draft is scrolled past its first line: the composer is not at
 * its top, and a pull down on it folds nothing — over the draft it scrolls back
 * to the earlier lines, the way any list does.
 */
export function scrollsDraftBack(draft: { readonly scrollTop: number }): boolean {
  return draft.scrollTop > DRAFT_SCROLL_SLACK;
}

/** How many pixels an edge of the composer may stand off the screen and still count as in view. */
const VIEW_EDGE_SLACK = 4;

/**
 * Where the composer stands against the part of the screen the keyboard
 * leaves: its top and its foot, and the top and the bottom of what is seen —
 * all in px from the top of the layout viewport, the frame both
 * `getBoundingClientRect` and `visualViewport.offsetTop` count in, not from the
 * top of the document.
 */
export interface ComposerInView {
  readonly top: number;
  readonly bottom: number;
  readonly viewTop: number;
  readonly viewBottom: number;
}

/**
 * Whether the top of the composer has gone above what is seen — a long draft
 * with the keyboard out: a pull down then scrolls back up to it, the way any
 * page does, and folds nothing.
 */
export function topOutOfView(composer: ComposerInView): boolean {
  return composer.viewTop - composer.top > VIEW_EDGE_SLACK;
}

/**
 * Whether the foot of the composer has gone under the keyboard — scrolled up
 * to the top of a long draft: a push up then scrolls back down to it, if the
 * composer is taller than what is seen too — see `overflowsView`.
 */
export function bottomOutOfView(composer: ComposerInView): boolean {
  return composer.bottom - composer.viewBottom > VIEW_EDGE_SLACK;
}

/**
 * Whether the foot of the composer stands in what is seen. A composer found
 * with its foot out of it — under the keyboard bb has not laid its screen out
 * for yet, or above the top — gives no measure of its room.
 */
export function footInView(composer: ComposerInView): boolean {
  return composer.bottom > composer.viewTop && !bottomOutOfView(composer);
}

/**
 * Whether the composer is taller than what is seen. A push up over one that
 * fits is held whatever its foot does under the keyboard, so the screen does
 * not shake; the push up a long draft needs to get back to its foot is the
 * only one let through.
 */
export function overflowsView(composer: ComposerInView): boolean {
  return composer.bottom - composer.top - (composer.viewBottom - composer.viewTop) > VIEW_EDGE_SLACK;
}

/**
 * How far under the top of the part of the screen the keyboard leaves the
 * composer stops, in px: room for the status bar and bb's header over the
 * thread on a phone, which end about 109 px down.
 */
export const COMPOSER_TOP_RESERVE = 120;

/** Where the draft sits in the composer, against the top of what is seen; px from the top of the layout viewport, as in `ComposerInView`. */
export interface DraftPlace {
  readonly formTop: number;
  readonly draftTop: number;
  readonly draftBottom: number;
  readonly viewTop: number;
}

/**
 * How tall the draft may grow, in px, for the composer to stay under the top
 * of what is seen — see `COMPOSER_TOP_RESERVE`. The composer grows up from its
 * foot, so the draft's foot stays where it is whatever its height, and the room
 * is the run from there up to the top, less what sits above the draft in the
 * composer.
 * Whole pixels, never less than one line. A composer that grows down from its
 * top would get a room that drifts with every fit — bb draws none.
 */
export function draftRoom(place: DraftPlace): number {
  const above = place.draftTop - place.formTop;
  return Math.max(COMPOSER_FOLDED_HEIGHT, Math.floor(place.draftBottom - place.viewTop - above));
}

/**
 * Whether a move of a finger that started on the composer is kept from the
 * page: everything that goes more down than sideways, from the first pixel —
 * iOS hands the whole touch to a scroll the moment it sees one move nobody
 * stopped. A move up is the home swipe's or the page's.
 */
export function claimsFold(start: Point, now: Point): boolean {
  return now.y - start.y > Math.abs(now.x - start.x);
}

/** How the composer looks under a finger pulling it down. */
export interface FoldDrag {
  /** How tall the composer stands, in px, from its own height down to `COMPOSER_FOLDED_HEIGHT`. */
  readonly height: number;
  /** Letting go right here folds it. */
  readonly armed: boolean;
  /** The finger is pulling the composer. */
  readonly holds: boolean;
}

/**
 * The composer, `full` px tall at the touch, under a finger that has gone from
 * `start` to `now`. Out of the dead zone and upright it loses as much height as
 * the finger has gone down, never below one line. Letting go folds it from the
 * reach on, or as soon as it has shrunk all the way to one line, so a short
 * composer folds within its own height. A finger barely moved, gone up or
 * wandered sideways leaves it whole.
 */
export function foldDrag(start: Point, now: Point, full: number): FoldDrag {
  const pulled = now.y - start.y;
  if (pulled < COMPOSER_FOLD_DEAD_ZONE || pulled <= Math.abs(now.x - start.x)) {
    return { height: full, armed: false, holds: false };
  }
  const height = Math.min(full, Math.max(COMPOSER_FOLDED_HEIGHT, full - pulled));
  const shrunkToOneLine = full > COMPOSER_FOLDED_HEIGHT && height === COMPOSER_FOLDED_HEIGHT;
  return { height, armed: pulled >= COMPOSER_FOLD_REACH || shrunkToOneLine, holds: true };
}

/**
 * Where on the composer a pull starts. The body — the draft and what sits
 * above the buttons — folds the composer and puts the keyboard away with it;
 * the panel — the row of buttons, the project and environment row under the
 * composer — puts the keyboard away and leaves the composer as it stands.
 */
export type FoldZone = "body" | "panel";

/** The zone a finger lands in: in the row of buttons, or in the composer but outside its form, is the panel. */
export function foldZone(place: { readonly inActionRow: boolean; readonly inForm: boolean }): FoldZone {
  return place.inActionRow || !place.inForm ? "panel" : "body";
}

/**
 * Whether a finger let go here, having pulled the composer down, puts the
 * keyboard away: the reach, more down than sideways.
 */
export function dismissesKeyboard(start: Point, now: Point): boolean {
  const pulled = now.y - start.y;
  return pulled >= COMPOSER_FOLD_REACH && pulled > Math.abs(now.x - start.x);
}

/**
 * Whether a move over an open composer is kept from the page: a push up, from
 * the first pixel. An open composer has nothing a push up could do, and let
 * through, it scrolls the page under the keyboard and shakes the screen.
 */
export function holdsOpenComposer(start: Point, now: Point): boolean {
  return start.y - now.y > Math.abs(now.x - start.x);
}

/** Whether the composer stands open: neither folded to one line here nor drawn compact by bb. */
export function composerOpen(look: { readonly folded: boolean; readonly compact: boolean }): boolean {
  return !look.folded && !look.compact;
}
