import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dayEdges, hourEdges, SERIES_SLOTS, seriesColor } from "./closed-model";

// Local calendar arithmetic is the point of these edges, so pin a zone with a
// daylight-saving switch (Europe/Berlin: 2026-03-29 has 23 hours).
const previousTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});
afterAll(() => {
  process.env.TZ = previousTz;
});

const HOUR_MS = 3_600_000;
const local = (text: string) => new Date(text).getTime();

const arbitraryNow = fc.integer({ min: local("2020-01-01T00:00:00"), max: local("2030-01-01T00:00:00") });

describe("hourEdges — the 24 local hours ending with the current one", () => {
  it("starts 23 hours before the current hour and ends where the current hour ends", () => {
    const edges = hourEdges(local("2026-09-24T14:37:12"));
    expect(edges).toHaveLength(25);
    expect(edges[0]).toBe(local("2026-09-23T15:00:00"));
    expect(edges[23]).toBe(local("2026-09-24T14:00:00"));
    expect(edges[24]).toBe(local("2026-09-24T15:00:00"));
  });

  it("always gives 25 strictly increasing edges with now inside the last column", () => {
    fc.assert(
      fc.property(arbitraryNow, (now) => {
        const edges = hourEdges(now);
        expect(edges).toHaveLength(25);
        edges.slice(1).forEach((edge, index) => expect(edge).toBeGreaterThan(edges[index]!));
        expect(edges[23]!).toBeLessThanOrEqual(now);
        expect(now).toBeLessThan(edges[24]!);
      }),
    );
  });
});

describe("dayEdges — the 30 local days ending with today", () => {
  it("starts at local midnight 29 days ago and ends at the next local midnight", () => {
    const edges = dayEdges(local("2026-09-24T14:37:12"));
    expect(edges).toHaveLength(31);
    expect(edges[0]).toBe(local("2026-08-26T00:00:00"));
    expect(edges[29]).toBe(local("2026-09-24T00:00:00"));
    expect(edges[30]).toBe(local("2026-09-25T00:00:00"));
  });

  it("gives the daylight-saving day its own length instead of drifting off midnight", () => {
    const edges = dayEdges(local("2026-04-05T09:00:00"));
    const switchDay = edges.indexOf(local("2026-03-29T00:00:00"));
    expect(edges[switchDay + 1]! - edges[switchDay]!).toBe(23 * HOUR_MS);
    expect(edges[switchDay + 1]).toBe(local("2026-03-30T00:00:00"));
  });

  it("always gives 31 strictly increasing edges with now inside the last column", () => {
    fc.assert(
      fc.property(arbitraryNow, (now) => {
        const edges = dayEdges(now);
        expect(edges).toHaveLength(31);
        edges.slice(1).forEach((edge, index) => expect(edge).toBeGreaterThan(edges[index]!));
        expect(edges[29]!).toBeLessThanOrEqual(now);
        expect(now).toBeLessThan(edges[30]!);
      }),
    );
  });
});

describe("seriesColor — a fixed categorical order, never cycled", () => {
  it("gives each of the first slots its own colour and every later project the muted one", () => {
    const slots = Array.from({ length: SERIES_SLOTS }, (_, index) => seriesColor(index));
    expect(new Set(slots).size).toBe(SERIES_SLOTS);
    expect(seriesColor(SERIES_SLOTS)).toBe("var(--muted-foreground)");
    expect(seriesColor(SERIES_SLOTS + 5)).toBe("var(--muted-foreground)");
  });
});

