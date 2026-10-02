// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { dayEdges, hourEdges } from "./closed-model";
import { columnUnit, tileEdges, unitEdges, windowEdges } from "./default-dashboard";

const now = new Date(2026, 9, 1, 13, 30, 20).getTime();

describe("unitEdges — the last N minutes, hours or days", () => {
  it("gives N columns, each one unit, the last ending after now", () => {
    fc.assert(
      fc.property(fc.constantFrom("minute" as const, "hour" as const), fc.integer({ min: 1, max: 300 }), (unit, count) => {
        const edges = unitEdges(unit, count, now);
        const step = unit === "minute" ? 60_000 : 3_600_000;
        expect(edges).toHaveLength(count + 1);
        edges.slice(1).forEach((edge, index) => expect(edge - edges[index]!).toBe(step));
        expect(edges.at(-2)!).toBeLessThanOrEqual(now);
        expect(edges.at(-1)!).toBeGreaterThan(now);
      }),
    );
  });

  it("matches the old fixed spans: 24 hours and 30 days", () => {
    expect(unitEdges("hour", 24, now)).toEqual(hourEdges(now));
    expect(unitEdges("day", 30, now)).toEqual(dayEdges(now));
  });

  it("puts every day edge on a local midnight", () => {
    unitEdges("day", 400, now).forEach((edge) => expect(new Date(edge).getHours() * 60 + new Date(edge).getMinutes()).toBe(0));
  });
});

describe("tileEdges and columnUnit", () => {
  it("follow the header on the page's period", () => {
    expect(tileEdges("page", "month", now, now)).toEqual(windowEdges("month", now, now));
    expect(columnUnit("page", "day")).toBe("hour");
  });

  it("read the tile's own unit otherwise", () => {
    expect(tileEdges({ unit: "minute", count: 90 }, "week", now, now)).toEqual(unitEdges("minute", 90, now));
    expect(columnUnit({ unit: "minute", count: 90 }, "week")).toBe("minute");
    expect(columnUnit({ unit: "day", count: 14 }, "day")).toBe("day");
  });
});
