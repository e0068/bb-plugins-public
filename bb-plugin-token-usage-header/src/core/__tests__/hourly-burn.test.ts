import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { barHeightPx, HOUR_MS, hourlyBurnBuckets } from "../hourly-burn";
import { binTotal, type ThreadEntry, type TimelineBin } from "../threads-timeline";

/** Fixed "now" for every test — the core never reads the clock. Deliberately NOT grid-aligned (:17 past the hour) so an anchor-to-`toMs` bug (rather than anchor-to-the-hour-grid) would show up as a failing test — see the anchoring tests below. */
const NOW_MS = Date.parse("2026-09-03T12:17:00.000Z");
/** The hour-grid slot NOW_MS falls in — bins are always emitted at exactly this kind of boundary (see HOUR_MS's doc comment in ../hourly-burn.ts). */
const CURRENT_HOUR_START_MS = Date.parse("2026-09-03T12:00:00.000Z");

/** A bin at an exact hour-grid boundary, `hoursBeforeCurrent` hours before CURRENT_HOUR_START_MS. */
function gridBin(hoursBeforeCurrent: number, total: number): TimelineBin {
  return {
    t: new Date(CURRENT_HOUR_START_MS - hoursBeforeCurrent * HOUR_MS).toISOString(),
    agents: total === 0 ? [] : [{ key: "main", total }],
  };
}

function thread(bins: TimelineBin[]): ThreadEntry {
  return {
    session: "sess-1",
    project: "-Users-e0068-Projects-demo",
    title: "sess-1",
    start: new Date(NOW_MS - 4 * HOUR_MS).toISOString(),
    end: new Date(NOW_MS - HOUR_MS).toISOString(),
    durationSec: 10800,
    totalTokens: bins.reduce((sum, b) => sum + binTotal(b), 0),
    totalCost: 1,
    workflowCount: 0,
    cwd: null,
    gitBranch: null,
    events: [],
    bbProjectId: null,
    bbProjectName: "Demo",
    threadId: null,
    bbThreadTitle: null,
    isAlive: false,
    isWorking: false,
    bins,
  };
}

describe("hourlyBurnBuckets", () => {
  it("returns no buckets when the window is empty, inverted, or non-finite", () => {
    expect(hourlyBurnBuckets([thread([gridBin(1, 100)])], NOW_MS, NOW_MS)).toEqual([]);
    expect(hourlyBurnBuckets([thread([gridBin(1, 100)])], NOW_MS, NOW_MS - HOUR_MS)).toEqual([]);
    expect(hourlyBurnBuckets([], NaN, NOW_MS)).toEqual([]);
    expect(hourlyBurnBuckets([], NOW_MS - HOUR_MS, NaN)).toEqual([]);
    expect(hourlyBurnBuckets([], -Infinity, NOW_MS)).toEqual([]);
  });

  it("labels a bucket by the real hour-grid slot its bin belongs to, not by an offset from toMs", () => {
    // NOW_MS is 12:17 — not on the hour grid. A bin at the grid-aligned
    // 11:00–12:00 slot must land in a bucket labelled 11:00, never
    // 11:17–12:17 (anchoring to toMs instead of the grid would produce that).
    const t = thread([gridBin(1, 100)]); // 11:00 UTC
    const result = hourlyBurnBuckets([t], NOW_MS - 2 * HOUR_MS, NOW_MS);
    const bucket = result.find((b) => b.tokens === 100)!;
    expect(new Date(bucket.hourStartMs).toISOString()).toBe("2026-09-03T11:00:00.000Z");
  });

  it("includes the hour that just ended as the last bucket when toMs itself sits exactly on the grid", () => {
    // toMs === 12:00 exactly (a grid boundary). The bin for 11:00-12:00 (t
    // = 11:00) must still be the last, non-empty bucket — an off-by-one that
    // treats "toMs is on the grid" as "the 12:00 slot is included" would
    // instead produce an extra, always-empty trailing bucket here.
    const t = thread([gridBin(1, 50)]); // t = 11:00 UTC
    const result = hourlyBurnBuckets([t], CURRENT_HOUR_START_MS - HOUR_MS, CURRENT_HOUR_START_MS);
    expect(result).toEqual([{ hourStartMs: CURRENT_HOUR_START_MS - HOUR_MS, tokens: 50 }]);
  });

  it("sums multiple threads and multiple agents landing in the same hour", () => {
    const a = thread([gridBin(1, 40)]);
    const b = thread([{ ...gridBin(1, 0), agents: [{ key: "main", total: 15 }, { key: "sub", total: 5 }] }]);
    const result = hourlyBurnBuckets([a, b], NOW_MS - 2 * HOUR_MS, NOW_MS);
    const bucket = result.find((r) => r.hourStartMs === CURRENT_HOUR_START_MS - HOUR_MS)!;
    expect(bucket.tokens).toBe(60);
  });

  it("drops bins outside [fromMs, toMs) and bins with an unparseable timestamp", () => {
    const t = thread([gridBin(1, 100), gridBin(10, 999), { t: "not-a-date", agents: [{ key: "main", total: 5 }] }]);
    const result = hourlyBurnBuckets([t], NOW_MS - 2 * HOUR_MS, NOW_MS);
    const nonZero = result.filter((b) => b.tokens > 0);
    expect(nonZero).toEqual([{ hourStartMs: CURRENT_HOUR_START_MS - HOUR_MS, tokens: 100 }]);
  });

  it("law: every bucket start sits on the absolute hour grid", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 2000, noNaN: true }), (spanHours) => {
        const result = hourlyBurnBuckets([], NOW_MS - spanHours * HOUR_MS, NOW_MS);
        for (const bucket of result) expect(bucket.hourStartMs % HOUR_MS).toBe(0);
      }),
    );
  });

  it("law: consecutive bucket starts are exactly one hour apart", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 500, noNaN: true }), (spanHours) => {
        const result = hourlyBurnBuckets([], NOW_MS - spanHours * HOUR_MS, NOW_MS);
        for (let i = 1; i < result.length; i++) {
          expect(result[i].hourStartMs - result[i - 1].hourStartMs).toBe(HOUR_MS);
        }
      }),
    );
  });

  it("law: the first bucket is the smallest hour-grid slot >= fromMs, the last the largest < toMs", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 500, noNaN: true }), (spanHours) => {
        const fromMs = NOW_MS - spanHours * HOUR_MS;
        const result = hourlyBurnBuckets([], fromMs, NOW_MS);
        if (result.length === 0) return; // a sub-hour window can legitimately contain no grid slot at all
        const first = result[0].hourStartMs;
        const last = result[result.length - 1].hourStartMs;
        expect(first).toBeGreaterThanOrEqual(fromMs);
        expect(first - HOUR_MS).toBeLessThan(fromMs);
        expect(last).toBeLessThan(NOW_MS);
        expect(last + HOUR_MS).toBeGreaterThanOrEqual(NOW_MS);
      }),
    );
  });

  it("law: total tokens across all buckets equals the sum of binTotal for bins actually inside the window", () => {
    fc.assert(
      fc.property(
        // Real bins are always exactly hour-aligned (see HOUR_MS's doc
        // comment) — an integer offset keeps every generated bin genuinely
        // on the grid, unlike a fc.double whose tiny fractional part gets
        // truncated away by the Date round-trip below and can land the bin
        // 1ms off the grid it was meant to sit on.
        fc.array(
          fc.array(fc.record({ hoursBeforeCurrent: fc.integer({ min: 0, max: 50 }), total: fc.nat({ max: 1_000_000 }) }), {
            maxLength: 10,
          }),
          { maxLength: 5 },
        ),
        fc.double({ min: 1, max: 48, noNaN: true }),
        (threadsBins, spanHours) => {
          const fromMs = NOW_MS - spanHours * HOUR_MS;
          const threads = threadsBins.map((bins) => thread(bins.map((b) => gridBin(b.hoursBeforeCurrent, b.total))));
          const result = hourlyBurnBuckets(threads, fromMs, NOW_MS);

          const expectedTotal = threads
            .flatMap((t) => t.bins)
            .filter((b) => {
              const t = Date.parse(b.t);
              return !Number.isNaN(t) && t >= fromMs && t < NOW_MS;
            })
            .reduce((sum, b) => sum + binTotal(b), 0);

          const actualTotal = result.reduce((sum, b) => sum + b.tokens, 0);
          expect(actualTotal).toBeCloseTo(expectedTotal, 6);
        },
      ),
    );
  });
});

describe("barHeightPx", () => {
  it("draws nothing for zero tokens or a non-positive maxTokens", () => {
    expect(barHeightPx(0, 100, 56, 2)).toBe(0);
    expect(barHeightPx(10, 0, 56, 2)).toBe(0);
    expect(barHeightPx(10, -5, 56, 2)).toBe(0);
  });

  it("the tallest bucket (tokens === maxTokens) fills the full chart height", () => {
    expect(barHeightPx(100, 100, 56, 2)).toBe(56);
  });

  it("floors a tiny non-zero amount at minHeightPx instead of rounding it away to a sliver under it", () => {
    expect(barHeightPx(1, 1_000_000, 56, 2)).toBe(2);
  });

  it("law: height is proportional to tokens/maxTokens once above the floor", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (tokens, maxTokens) => {
        fc.pre(tokens <= maxTokens);
        const proportional = (tokens / maxTokens) * 56;
        const height = barHeightPx(tokens, maxTokens, 56, 2);
        expect(height).toBe(Math.max(proportional, 2));
      }),
    );
  });
});
