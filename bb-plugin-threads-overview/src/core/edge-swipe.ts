// Pure rules for the sideways swipes that start at the edges of the screen:
// from the left edge to the right the finger asks for bb's left panel, from
// the right edge to the left for the right panel of a thread, or on Home for
// the actions of the row under it. A finger slid in from beyond the screen
// lands outside every row and on the project slides, so the edges are decided
// for the whole screen, not row by row. Layer 1: depends only on the shape of
// a point.
import type { Point } from "./home-swipe";
import { startsRowSwipe } from "./swipe";

/** The share of the screen's width, along its left edge, where a swipe to the right opens bb's left panel. */
export const SIDEBAR_SWIPE_EDGE_SHARE = 0.15;

/**
 * How far from the left edge bb's own swipe for its left panel may start, in
 * px: bb leaves the strip nearer the edge alone. A finger put down there is
 * handed to bb's swipe shifted onto this floor — see `intoBbSidebarSwipe`.
 */
export const BB_SIDEBAR_SWIPE_FLOOR = 24;

/** Which edge strip a finger landed on: the left panel's, the rows' or neither. */
export type EdgeStrip = "sidebar" | "row" | null;

export function edgeStrip(x: number, screenWidth: number): EdgeStrip {
  if (x < screenWidth * SIDEBAR_SWIPE_EDGE_SHARE) return "sidebar";
  return startsRowSwipe(x, screenWidth) ? "row" : null;
}

/** Whether bb's own swipe takes a finger put down at `x`, so the panel follows the finger by itself. */
export function bbTakesSidebarSwipe(x: number): boolean {
  return x >= BB_SIDEBAR_SWIPE_FLOOR;
}

/**
 * Whether a move of a finger from the left strip is the panel's and is kept
 * from the slides: more to the right than up or down, from the first pixel —
 * iOS hands the whole touch to a scroll of the slides the moment it sees one
 * move nobody stopped. A move to the left is the slides', an upright one the
 * page's.
 */
export function claimsSidebarSwipe(start: Point, now: Point): boolean {
  const dx = now.x - start.x;
  return dx > 0 && dx > Math.abs(now.y - start.y);
}

/**
 * Where bb's own swipe hears a point of a finger put down at `start`: a finger
 * nearer the edge than bb listens is moved onto bb's floor, and every later
 * point by the same shift, so the panel follows it pixel for pixel from the
 * first move. A finger bb takes by itself stays where it is.
 */
export function intoBbSidebarSwipe(start: Point, point: Point): Point {
  return { x: point.x + Math.max(0, BB_SIDEBAR_SWIPE_FLOOR - start.x), y: point.y };
}

/** A row's span down the screen, in px. */
export interface RowSpan {
  readonly top: number;
  readonly bottom: number;
}

/** The index of the row whose span holds `y`, or `null` when the finger is between rows or past them. */
export function rowAt(rows: readonly RowSpan[], y: number): number | null {
  const index = rows.findIndex((row) => y >= row.top && y < row.bottom);
  return index === -1 ? null : index;
}

/**
 * Whether a move of a finger from the right strip of a thread is the right
 * panel's and is kept from the page: more to the left than up or down, from
 * the first pixel — the mirror of `claimsSidebarSwipe`. A move to the right is
 * the page's, an upright one the conversation's.
 */
export function claimsPanelSwipe(start: Point, now: Point): boolean {
  const dx = start.x - now.x;
  return dx > 0 && dx > Math.abs(now.y - start.y);
}

/** How far the right panel is open under a finger gone from `start` to `now`, from 0 to 1 of `width`. */
export function panelProgress(start: Point, now: Point, width: number): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, (start.x - now.x) / width));
}

/** The share of the screen past which letting go opens the right panel — bb's own threshold for its left one. */
export const PANEL_OPEN_SHARE = 1 / 3;

/** The share past which a quick flick opens the right panel all the same. */
export const PANEL_FLICK_SHARE = 0.12;

/** How fast a flick to the left has to be to open the panel from `PANEL_FLICK_SHARE`, in px/s. */
export const PANEL_FLICK_SPEED = 450;

/**
 * Whether letting go opens the right panel: pulled past a third of the screen,
 * or past `PANEL_FLICK_SHARE` while still flying to the left. `velocityX` is
 * the finger's speed along the screen at the lift, in px/s; to the left is
 * below zero.
 */
export function opensPanel(progress: number, velocityX: number): boolean {
  return progress >= PANEL_OPEN_SHARE || (progress >= PANEL_FLICK_SHARE && -velocityX >= PANEL_FLICK_SPEED);
}
