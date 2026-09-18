// Pure Postpone-map operations. The backend holds a threadId -> postponed-at
// map in KV; all its branching (add, drop-if-present, list) lives here so the
// server is left as trivial read/write wiring. Immutable: every change returns
// a new map. Layer 1: no effects, no SDK.

/** threadId -> epoch ms the user postponed it. */
export type PostponedMap = Readonly<Record<string, number>>;

export interface PostponedEntry {
  readonly threadId: string;
  readonly at: number;
}

export function hasMark(map: PostponedMap, threadId: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, threadId);
}

/** Mark a thread postponed at `at`, returning a new map. */
export function addMark(
  map: PostponedMap,
  threadId: string,
  at: number,
): PostponedMap {
  return { ...map, [threadId]: at };
}

/** Drop a thread's mark. Returns the same map when there was nothing to drop, so
 *  callers can skip writing and notifying on a no-op. */
export function dropMark(map: PostponedMap, threadId: string): PostponedMap {
  if (!hasMark(map, threadId)) return map;
  const next = { ...map };
  delete next[threadId];
  return next;
}

export function toEntries(map: PostponedMap): PostponedEntry[] {
  return Object.entries(map).map(([threadId, at]) => ({ threadId, at }));
}
