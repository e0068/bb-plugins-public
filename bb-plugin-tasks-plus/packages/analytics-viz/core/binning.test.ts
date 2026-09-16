import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { bucketByTime, type BucketSpec } from "./binning";

// A record is just a timestamp and a metric — the core never sees a domain type.
interface Datum {
  at: number;
  amount: number;
}

const datumArb = fc.record({
  at: fc.integer({ min: -1_000_000, max: 1_000_000 }),
  amount: fc.integer({ min: -1000, max: 1000 }),
});

// A window and a bin size that keep the bucket count bounded (span/binMs stays
// in the low hundreds, so a case never builds a giant array), yet exercise
// non-grid-aligned edges (from/to rarely land on a binMs boundary).
const specArb = fc
  .record({
    fromMs: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    span: fc.integer({ min: 1, max: 50_000 }),
    binMs: fc.integer({ min: 200, max: 5000 }),
  })
  .map(({ fromMs, span, binMs }) => ({ fromMs, toMs: fromMs + span, binMs }));

function spec(from: number, to: number, bin: number): BucketSpec<Datum> {
  return { timeMs: (d) => d.at, value: (d) => d.amount, fromMs: from, toMs: to, binMs: bin };
}

const inRange = (d: Datum, fromMs: number, toMs: number) => d.at >= fromMs && d.at < toMs;
const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

describe("bucketByTime — conservation", () => {
  it("total across bins equals the total of every in-window record, for any input", () => {
    fc.assert(
      fc.property(fc.array(datumArb), specArb, (records, { fromMs, toMs, binMs }) => {
        const bins = bucketByTime(records, spec(fromMs, toMs, binMs));
        const expected = sum(records.filter((d) => inRange(d, fromMs, toMs)).map((d) => d.amount));
        expect(sum(bins.map((b) => b.value))).toBe(expected);
      }),
    );
  });

  it("assigns each record to the bin whose grid cell contains its timestamp", () => {
    fc.assert(
      fc.property(fc.array(datumArb), specArb, (records, { fromMs, toMs, binMs }) => {
        const bins = bucketByTime(records, spec(fromMs, toMs, binMs));
        for (const d of records) {
          if (!inRange(d, fromMs, toMs)) continue;
          const bin = bins.find((b) => d.at >= b.startMs && d.at < b.startMs + binMs);
          expect(bin).toBeDefined();
        }
      }),
    );
  });
});

describe("bucketByTime — grid & shape", () => {
  it("emits a gapless, ascending grid of bins, each start a multiple of binMs", () => {
    fc.assert(
      fc.property(specArb, ({ fromMs, toMs, binMs }) => {
        const bins = bucketByTime<Datum>([], spec(fromMs, toMs, binMs));
        expect(bins.length).toBeGreaterThan(0);
        bins.forEach((b, i) => {
          expect(Math.abs(b.startMs % binMs)).toBe(0);
          if (i > 0) expect(b.startMs - bins[i - 1].startMs).toBe(binMs);
        });
      }),
    );
  });

  it("covers the whole window — first bin holds fromMs, last bin holds the last instant before toMs", () => {
    fc.assert(
      fc.property(specArb, ({ fromMs, toMs, binMs }) => {
        const bins = bucketByTime<Datum>([], spec(fromMs, toMs, binMs));
        const first = bins[0].startMs;
        const last = bins[bins.length - 1].startMs;
        expect(first).toBeLessThanOrEqual(fromMs);
        expect(first + binMs).toBeGreaterThan(fromMs);
        expect(last).toBeLessThan(toMs);
        expect(last + binMs).toBeGreaterThanOrEqual(toMs);
      }),
    );
  });
});

describe("bucketByTime — totality on degenerate input", () => {
  const one: Datum = { at: 0, amount: 5 };

  it("returns no bins on an empty or inverted window", () => {
    expect(bucketByTime([one], spec(100, 100, 10))).toEqual([]);
    expect(bucketByTime([one], spec(100, 50, 10))).toEqual([]);
  });

  it("returns no bins on a non-positive or non-finite bin size", () => {
    expect(bucketByTime([one], spec(0, 100, 0))).toEqual([]);
    expect(bucketByTime([one], spec(0, 100, -10))).toEqual([]);
    expect(bucketByTime([one], spec(0, 100, Number.NaN))).toEqual([]);
  });

  it("returns no bins when a window bound is non-finite", () => {
    expect(bucketByTime([one], spec(Number.NaN, 100, 10))).toEqual([]);
    expect(bucketByTime([one], spec(0, Number.POSITIVE_INFINITY, 10))).toEqual([]);
  });

  it("skips a record whose timestamp is non-finite, keeping the rest", () => {
    const records: Datum[] = [
      { at: Number.NaN, amount: 999 },
      { at: 5, amount: 3 },
    ];
    const bins = bucketByTime(records, spec(0, 10, 10));
    expect(sum(bins.map((b) => b.value))).toBe(3);
  });

  it("treats a non-finite metric as zero rather than poisoning the bin", () => {
    const records: Datum[] = [
      { at: 1, amount: Number.NaN },
      { at: 2, amount: 4 },
    ];
    const bins = bucketByTime(records, spec(0, 10, 10));
    expect(sum(bins.map((b) => b.value))).toBe(4);
  });
});
