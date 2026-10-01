import type { TaskStatus } from "../../shared/enums.js";

/** Always-visible columns in board order; Canceled is appended on demand. */
export const BOARD_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
] as const satisfies readonly TaskStatus[];

/**
 * Reorder neighbors for a board drop, matching the `boardMove` RPC contract:
 * `beforeTaskId` is the card that sorts BEFORE (above) the dropped card and
 * `afterTaskId` the card that sorts AFTER (below) it.
 */
export interface BoardDropNeighbors {
  beforeTaskId: string | null;
  afterTaskId: string | null;
}

/**
 * Maps a drop index to the before/after neighbor ids the server expects.
 *
 * `columnTaskIds` is the destination column's current top-to-bottom order and
 * may still contain the dragged card (same-column reorder); it is excluded
 * first. `dropIndex` is the insertion slot among the REMAINING cards
 * (0 = top, length = bottom) and is clamped into range.
 */
export function dropNeighborsForIndex(
  columnTaskIds: readonly string[],
  draggedTaskId: string,
  dropIndex: number,
): BoardDropNeighbors {
  const ids = columnTaskIds.filter((id) => id !== draggedTaskId);
  const index = Math.max(0, Math.min(dropIndex, ids.length));
  return {
    beforeTaskId: ids[index - 1] ?? null,
    afterTaskId: ids[index] ?? null,
  };
}

/**
 * Insertion slot for a pointer at `pointerY`, given the vertical centers of
 * the column's cards (top-to-bottom, dragged card excluded): the card count
 * whose center sits above the pointer.
 */
export function dropIndexForPointer(
  cardCenterYs: readonly number[],
  pointerY: number,
): number {
  let index = 0;
  for (const centerY of cardCenterYs) {
    if (pointerY > centerY) index += 1;
  }
  return index;
}

/** Where a card sits on screen — the part of a DOMRect a drop looks at. */
export interface CardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far a point is from a card: 0 inside it, else to its nearest edge. */
function distanceTo(card: CardRect, x: number, y: number): number {
  const dx = Math.max(card.left - x, 0, x - (card.left + card.width));
  const dy = Math.max(card.top - y, 0, y - (card.top + card.height));
  return Math.hypot(dx, dy);
}

/**
 * Insertion slot for a pointer over the ungrouped grid, given its cards in
 * reading order (dragged card excluded): the card nearest the pointer, and
 * the slot before it when the pointer is on its left half, after it on the
 * right — the grid flows left to right, so that is where the card would land.
 */
export function gridDropIndex(cards: readonly CardRect[], x: number, y: number): number {
  if (cards.length === 0) return 0;
  const nearest = cards.reduce(
    (best, card, index) => {
      const distance = distanceTo(card, x, y);
      return distance < best.distance ? { index, distance } : best;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  );
  const card = cards[nearest.index]!;
  return x < card.left + card.width / 2 ? nearest.index : nearest.index + 1;
}
