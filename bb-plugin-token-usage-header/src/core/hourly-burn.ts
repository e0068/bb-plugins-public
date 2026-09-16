// Hourly token-burn buckets for the "Usage Analytics" summary block's D/W/M
// window (see project-costs.ts). Pure and total, like the rest of src/core:
// no I/O, no clock — `fromMs`/`toMs` arrive as numbers from the page, the
// same convention windowStartMs already uses.
//
// Reuses the bins UsageProjectsSummary.tsx already fetches at
// SUMMARY_UNIT_SECONDS (3600s = 1 hour) for the donut and thread list — no
// new RPC, no new pass over tools/threads_timeline.py.
import { binTotal, type ThreadEntry } from "./threads-timeline";

/** A bin's `t` is always a multiple of the report's `unit` (see TimelineBin's doc comment in threads-timeline.ts) — for this block's 3600s unit, that means every bin already sits on an absolute hour-of-day boundary. Exported so the chart's own tooltip formatting shares the same hour length instead of re-declaring it. */
export const HOUR_MS = 3_600_000;

/** One hour of the window: its start and the tokens spent across all threads inside it. */
export interface HourlyBurnBucket {
  hourStartMs: number;
  tokens: number;
}

/**
 * Tokens spent per hour across all `threads`, covering `[fromMs, toMs)` —
 * one bucket per absolute hour-of-day boundary a bin could actually land
 * on, NOT a boundary relative to `fromMs`/`toMs` themselves. This matters
 * because bins arrive pre-aligned to the hour grid (see the `HOUR_MS` doc
 * comment above): anchoring buckets to anything else would put a bin whose
 * own `t` is, say, "13:00" into a bucket labelled "12:47–13:47" — a lie by
 * up to 59 minutes. Concretely: `firstBucketStartMs` is the smallest
 * hour-grid multiple that is `>= fromMs`, `lastBucketStartMs` the largest
 * one `< toMs`; every grid multiple in between gets its own bucket. The
 * edge buckets can be shorter than a full hour when `fromMs`/`toMs` don't
 * themselves sit on the grid (a rolling D/W/M window usually doesn't) —
 * that's real: a bin can only ever fall in an edge bucket if the edge
 * bucket's own grid slot actually overlaps `[fromMs, toMs)`, so a bucket
 * that couldn't hold any in-range bin is never created in the first place.
 *
 * Total on every input: non-finite `fromMs`/`toMs`, or `toMs <= fromMs`,
 * return no buckets rather than throwing or returning a negative-length
 * array. A bin with an unparseable `t`, or one whose `t` falls outside
 * `[fromMs, toMs)`, is skipped — same "doesn't guess a time" rule
 * threadCostInWindow follows.
 */
export function hourlyBurnBuckets(threads: readonly ThreadEntry[], fromMs: number, toMs: number): HourlyBurnBucket[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];

  const firstBucketStartMs = Math.ceil(fromMs / HOUR_MS) * HOUR_MS;
  const lastBucketStartMs = Math.ceil(toMs / HOUR_MS) * HOUR_MS - HOUR_MS;
  if (lastBucketStartMs < firstBucketStartMs) return [];

  const bucketCount = (lastBucketStartMs - firstBucketStartMs) / HOUR_MS + 1;
  const tokensByHour = new Array<number>(bucketCount).fill(0);

  for (const thread of threads) {
    for (const bin of thread.bins) {
      const t = Date.parse(bin.t);
      if (Number.isNaN(t) || t < fromMs || t >= toMs) continue;
      // A bin inside [fromMs, toMs) is, by construction of firstBucketStartMs/
      // lastBucketStartMs above, always within [firstBucketStartMs,
      // lastBucketStartMs] when it's grid-aligned — the bounds check below is
      // defensive only, for a bin whose `t` (from some future/foreign data
      // source) doesn't actually sit on this HOUR_MS grid.
      const index = Math.floor((t - firstBucketStartMs) / HOUR_MS);
      if (index < 0 || index >= bucketCount) continue;
      tokensByHour[index] += binTotal(bin);
    }
  }

  return tokensByHour.map((tokens, index) => ({ hourStartMs: firstBucketStartMs + index * HOUR_MS, tokens }));
}

/**
 * Bar height in px for one bucket's tokens, relative to the tallest bucket
 * in view — the chart-geometry counterpart of donutArcs in project-costs.ts:
 * pure numbers, no DOM. 0 tokens (or a non-positive `maxTokens` — nothing to
 * be relative to) draws nothing; any positive amount is floored at
 * `minHeightPx` so a very small hour still shows as a visible sliver instead
 * of vanishing.
 */
export function barHeightPx(tokens: number, maxTokens: number, chartHeightPx: number, minHeightPx: number): number {
  if (tokens <= 0 || maxTokens <= 0) return 0;
  return Math.max((tokens / maxTokens) * chartHeightPx, minHeightPx);
}
