// Geometry for the custom lane-timeline SVG — the part of the hybrid Recharts
// can't draw: a single horizontal lane split into contiguous, weight-
// proportional segments with pixel gaps between them (the segmented lanes of
// thread-chart.tsx, generalised). Pure numbers in, positions out.

/** One segment's placement along the lane. */
export interface LaneSegment {
  /** Left edge in px, measured from the lane's own origin. */
  x: number;
  /** Segment width in px; never negative. */
  width: number;
}

/**
 * Lays `weights` as contiguous segments across `totalWidth`, each as wide as
 * its share of the total weight, with `gapPx` of empty space between adjacent
 * segments (never before the first or after the last). Segments are returned in
 * input order, never overlap, and none extends past `totalWidth`.
 *
 * Conservation: the segment widths sum to the drawable width —
 * `max(totalWidth - gapPx*(n-1), 0)` — so no pixel of value silently vanishes.
 * When every weight is zero (or non-positive) the drawable width is split
 * equally, so an all-empty lane still reads as n even slots rather than
 * collapsing to nothing.
 *
 * Total: an empty `weights` yields `[]`; a non-finite weight counts as 0; a
 * non-finite `totalWidth`/`gapPx`, or a `totalWidth` smaller than the gaps
 * need, yields zero-width segments at their proper x rather than negatives.
 */
export function laneSegments(weights: readonly number[], totalWidth: number, gapPx: number): LaneSegment[] {
  const n = weights.length;
  if (n === 0) return [];

  const safeGap = Number.isFinite(gapPx) ? Math.max(gapPx, 0) : 0;
  const safeWidths = weights.map((w) => (Number.isFinite(w) ? Math.max(w, 0) : 0));
  const totalWeight = safeWidths.reduce((sum, w) => sum + w, 0);

  const gapsTotal = safeGap * (n - 1);
  const drawable = Number.isFinite(totalWidth) ? Math.max(totalWidth - gapsTotal, 0) : 0;

  const segments: LaneSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const share = totalWeight > 0 ? safeWidths[i] / totalWeight : 1 / n;
    const width = drawable * share;
    segments.push({ x: cursor, width });
    cursor += width + safeGap;
  }
  return segments;
}
