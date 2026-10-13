// Layer 1, zero imports: how far the draft has drifted from the file, counted
// in lines. The header's second row shows it as `+N −M`, so the two numbers
// have to mean what a reader of a diff expects: an insert in the middle counts
// one added line, not "everything below it changed".
//
// Counting is line-based on purpose — the same unit git and every diff viewer
// use. A character-level count would make a renamed variable look like a
// rewritten file.

export type LineDiffCount = { added: number; removed: number };

const NOTHING: LineDiffCount = { added: 0, removed: 0 };

/**
 * The longest common subsequence is quadratic. Common prefixes and suffixes
 * are trimmed first, which leaves a window the size of the actual edit — a
 * keystroke in a 2000-line file leaves a window of one line. The cap guards
 * the case the trim cannot help with: two texts that differ from the first
 * line to the last (a paste over everything, a file switched underneath).
 * Above it the window is counted as wholly replaced — the honest reading of
 * "these two texts have nothing in common", and the number the user sees
 * anyway when nothing lines up.
 */
const MAX_CELLS = 1_000_000;

/** Length of the longest common subsequence, rolling one row at a time. */
function commonLines(a: readonly string[], b: readonly string[]): number {
  // The rolling row is indexed by the SHORTER side, so memory follows the
  // smaller of the two, never the larger.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let previous = new Uint32Array(short.length + 1);
  let current = new Uint32Array(short.length + 1);

  for (const longLine of long) {
    for (let i = 0; i < short.length; i++) {
      current[i + 1] =
        longLine === short[i]
          ? previous[i] + 1
          : Math.max(previous[i + 1], current[i]);
    }
    [previous, current] = [current, previous];
  }
  return previous[short.length];
}

/**
 * Lines added and removed going from `before` to `after`. Mirrored inputs give
 * mirrored counts by construction: both sides are measured against the same
 * common subsequence.
 *
 * A text is split on "\n" and nothing else: a file that ends with a newline
 * has one more (empty) line than the same file without it, which is exactly
 * how the draft differs from the file after pressing Enter at the end.
 */
export function lineDiff(before: string, after: string): LineDiffCount {
  if (before === after) return NOTHING;

  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const removedWindow = endA - start;
  const addedWindow = endB - start;
  if (removedWindow === 0) return { added: addedWindow, removed: 0 };
  if (addedWindow === 0) return { added: 0, removed: removedWindow };

  const common =
    removedWindow * addedWindow > MAX_CELLS
      ? 0
      : commonLines(a.slice(start, endA), b.slice(start, endB));

  return { added: addedWindow - common, removed: removedWindow - common };
}
