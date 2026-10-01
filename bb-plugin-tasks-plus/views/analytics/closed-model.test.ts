import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ClosedTask } from "../../shared/contract.js";
import { closingsIn, dayEdges, hourEdges, projectSeries, SERIES_SLOTS, seriesColor, stackRows } from "./closed-model";

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

function closing(over: Partial<ClosedTask> = {}): ClosedTask {
  return { taskId: "T", key: "T-1", title: "Task", projectId: "P", atMs: 0, bin: 0, ...over };
}

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

describe("stackRows — one row per column, a count per project", () => {
  it("counts each column's closings by project, with a row for every empty column", () => {
    const rows = stackRows(
      [closing({ projectId: "P", bin: 0 }), closing({ projectId: "Q", bin: 0 }), closing({ projectId: "P", bin: 2 })],
      3,
    );
    expect(rows).toEqual([
      { bin: 0, counts: { P: 1, Q: 1 } },
      { bin: 1, counts: {} },
      { bin: 2, counts: { P: 1 } },
    ]);
  });

  it("keeps every closing: the counts add up to the number of closings in range", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ projectId: fc.constantFrom("P", "Q", "R"), bin: fc.integer({ min: 0, max: 5 }) })),
        (entries) => {
          const rows = stackRows(entries.map((entry) => closing(entry)), 6);
          const total = rows.flatMap((row) => Object.values(row.counts)).reduce((sum, count) => sum + count, 0);
          expect(rows).toHaveLength(6);
          expect(total).toBe(entries.length);
        },
      ),
    );
  });
});

describe("projectSeries — the projects a chart draws, coloured by their place on the board", () => {
  const projects = [
    { id: "A", name: "Alpha" },
    { id: "B", name: "Beta" },
    { id: "C", name: "Gamma" },
  ];

  it("lists only the projects with a closing in the window, in board order", () => {
    const series = projectSeries([closing({ projectId: "C" }), closing({ projectId: "A" })], projects);
    expect(series.map((entry) => entry.id)).toEqual(["A", "C"]);
    expect(series.map((entry) => entry.name)).toEqual(["Alpha", "Gamma"]);
  });

  it("colours a project by its board position, so both charts agree whatever else closed", () => {
    const onlyGamma = projectSeries([closing({ projectId: "C" })], projects);
    const all = projectSeries([closing({ projectId: "A" }), closing({ projectId: "C" })], projects);
    expect(onlyGamma[0]?.color).toBe(seriesColor(2));
    expect(all.find((entry) => entry.id === "C")?.color).toBe(seriesColor(2));
  });

  it("names a project the board no longer knows by its id", () => {
    expect(projectSeries([closing({ projectId: "Z" })], projects)).toEqual([
      { id: "Z", name: "Z", color: seriesColor(projects.length) },
    ]);
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

describe("closingsIn — the tasks behind one segment", () => {
  it("returns the segment's tasks newest first and nothing from other columns or projects", () => {
    const early = closing({ taskId: "1", projectId: "P", bin: 1, atMs: 10 });
    const late = closing({ taskId: "2", projectId: "P", bin: 1, atMs: 20 });
    const otherProject = closing({ taskId: "3", projectId: "Q", bin: 1, atMs: 15 });
    const otherColumn = closing({ taskId: "4", projectId: "P", bin: 0, atMs: 5 });
    expect(closingsIn([early, otherProject, late, otherColumn], { bin: 1, projectId: "P" })).toEqual([late, early]);
  });
});
