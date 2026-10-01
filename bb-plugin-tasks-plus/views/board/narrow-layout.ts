/**
 * Which columns the board draws — the keys of whatever it is grouped by.
 * Wide: all of them. Narrow: just the selected one — or the first, when
 * nothing is selected or the selection has left the board (its last task
 * moved away, and the column with it).
 *
 * Narrow is a boolean, not a width: the surface learns it from
 * `useIsCompactViewport` (≤767px), the same signal the rest of the plugin
 * flips its phone layout on, and a test can override that signal wholesale.
 */
export function visibleBoardColumns<K extends string>(
  isNarrow: boolean,
  keys: readonly K[],
  selected: K | null,
): readonly K[] {
  if (keys.length === 0) return [];
  if (!isNarrow) return keys;
  const shown =
    selected !== null && keys.includes(selected) ? selected : keys[0]!;
  return [shown];
}
