/**
 * The owner's manual order of a project's tasks: a list of task ids, top to
 * bottom, kept per project in the plugin's KV (see
 * docs/decisions/tasks-plus-manual-order-in-plugin-kv.md). Pure: the server
 * applies it to the tasks it reads and rewrites it on a drop.
 */

/** Where a dropped card lands — the `boardMove` contract: the card above it
 *  and the card below it, either missing at an edge. */
export interface OrderNeighbors {
  beforeTaskId: string | null;
  afterTaskId: string | null;
}

/** Newest first; string order of ISO-8601 UTC timestamps is chronological. */
const newestFirst = (a: { createdAt: string }, b: { createdAt: string }): number =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

/**
 * The items in the manual order. Items the order does not name yet — new
 * tasks, or every task before the first drag — come first, newest on top;
 * then the named ones in their saved places. Ids naming no item are skipped.
 */
export function applyOrder<T extends { id: string; createdAt: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  const place = new Map(order.map((id, index) => [id, index]));
  const unplaced = items.filter((entry) => !place.has(entry.id)).sort(newestFirst);
  const placed = items
    .filter((entry) => place.has(entry.id))
    .sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  return [...unplaced, ...placed];
}

/**
 * The whole order after a drop: the task stands right above the card that
 * should follow it, else right below the card that should precede it, else
 * at the end. Every other id keeps its place.
 */
export function moveInOrder(ids: readonly string[], taskId: string, neighbors: OrderNeighbors): string[] {
  const rest = ids.filter((id) => id !== taskId);
  const insertAt = (index: number) => [...rest.slice(0, index), taskId, ...rest.slice(index)];
  const below = neighbors.afterTaskId === null ? -1 : rest.indexOf(neighbors.afterTaskId);
  if (below !== -1) return insertAt(below);
  const above = neighbors.beforeTaskId === null ? -1 : rest.indexOf(neighbors.beforeTaskId);
  return above !== -1 ? insertAt(above + 1) : [...rest, taskId];
}
