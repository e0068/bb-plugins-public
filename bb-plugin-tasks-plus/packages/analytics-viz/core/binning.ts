// Generic time binning — the aggregation heart of every bar/burn chart,
// generalised out of bb-plugin-token-usage-header (hourly-burn.ts). The source
// summed `binTotal(bin)` over `ThreadEntry.bins`; here the domain type is gone,
// replaced by two selectors the caller passes in: `timeMs` reads a record's
// instant, `value` reads its metric. The core never imports a plugin.
//
// Pure and total: no I/O, no clock. Every bound and the bin size arrive as
// numbers.

/** One bin of the grid: its start and the metric summed inside it. */
export interface TimeBin {
  /** Grid-aligned start, a multiple of `binMs`. */
  startMs: number;
  /** Sum of `value(record)` over records whose `timeMs` lies in `[startMs, startMs + binMs)`. */
  value: number;
}

/** How to read one record and where to lay the grid. */
export interface BucketSpec<T> {
  /** Record's instant in epoch ms; a non-finite result drops the record (no time, no guessing one). */
  timeMs: (record: T) => number;
  /** Record's metric; a non-finite result counts as 0 rather than poisoning the whole bin to NaN. */
  value: (record: T) => number;
  /** Window start, inclusive. */
  fromMs: number;
  /** Window end, exclusive. */
  toMs: number;
  /** Bin width in ms; must be finite and positive. */
  binMs: number;
}

/**
 * Sums each record's metric into the bin of the absolute grid (multiples of
 * `binMs`) that contains its timestamp, over `[fromMs, toMs)`. The returned
 * grid is gapless and ascending — a bin with no records is present with a zero
 * value, so a chart reads a continuous time axis with no missing columns.
 *
 * The grid is anchored to absolute multiples of `binMs`, not to `fromMs`: a
 * record at 13:00 lands in the "13:00" cell whatever the window's own edges
 * are. The window's edge cells can therefore be only partially inside
 * `[fromMs, toMs)`; they are still emitted, because a record sitting in the
 * covered part of an edge cell is real and dropping it would violate the
 * conservation law this function guarantees:
 *
 *   sum(bins.value) === sum(value(record)) over every record whose `timeMs`
 *   is finite and inside `[fromMs, toMs)` and whose `value` is finite.
 *
 * (This is the one deliberate departure from hourly-burn.ts, which anchored to
 * the first *whole* cell and could drop a record in a partial leading cell —
 * safe there only because its bins were already hour-aligned. A domain-neutral
 * core cannot assume that, so it conserves instead.)
 *
 * Total on every input: a non-finite bound, a non-positive or non-finite
 * `binMs`, or `toMs <= fromMs` yields no bins rather than throwing.
 */
export function bucketByTime<T>(records: readonly T[], spec: BucketSpec<T>): TimeBin[] {
  const { timeMs, value, fromMs, toMs, binMs } = spec;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !Number.isFinite(binMs)) return [];
  if (binMs <= 0 || toMs <= fromMs) return [];

  // First grid cell that *contains* fromMs (floor, so a partial leading cell is
  // kept); last grid cell that still holds an instant < toMs.
  const firstStartMs = Math.floor(fromMs / binMs) * binMs;
  const lastStartMs = Math.ceil(toMs / binMs) * binMs - binMs;
  const count = Math.round((lastStartMs - firstStartMs) / binMs) + 1;
  if (count <= 0) return [];

  const values = new Array<number>(count).fill(0);
  for (const record of records) {
    const t = timeMs(record);
    if (!Number.isFinite(t) || t < fromMs || t >= toMs) continue;
    // In-range t always indexes within [0, count) by construction; the guard is
    // defensive against a caller whose selectors disagree with its bounds.
    const index = Math.floor((t - firstStartMs) / binMs);
    if (index < 0 || index >= count) continue;
    const metric = value(record);
    values[index] += Number.isFinite(metric) ? metric : 0;
  }

  return values.map((v, index) => ({ startMs: firstStartMs + index * binMs, value: v }));
}
