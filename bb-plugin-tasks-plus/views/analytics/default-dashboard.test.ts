import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dayEdges, hourEdges } from "./closed-model";
import {
  ANALYTICS_WINDOWS,
  DEFAULT_FILTER,
  SECTION_KINDS,
  columnDays,
  defaultAnalyticsRows,
  weekBreaksOf,
  weekEdges,
  windowEdges,
} from "./default-dashboard";
import { mergeSaved, parseSaved, serializeLayout } from "./row-layout";

// Same pinned zone as the closed-model edges: a daylight-saving switch inside.
const previousTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});
afterAll(() => {
  process.env.TZ = previousTz;
});

const local = (text: string) => new Date(text).getTime();
const arbitraryNow = fc.integer({ min: local("2020-01-01T00:00:00"), max: local("2030-01-01T00:00:00") });
const increasing = (edges: readonly number[]) => edges.every((edge, i) => i === 0 || edge > edges[i - 1]!);

describe("windowEdges — the columns each D/W/M cut is drawn in", () => {
  it("draws the day cut by the hour and the month cut by the day, as the closed charts do", () => {
    const now = local("2026-09-25T02:30:00");
    expect(windowEdges("day", now)).toEqual(hourEdges(now));
    expect(windowEdges("month", now)).toEqual(dayEdges(now));
  });

  it("draws the week cut as the last 7 local days ending with today", () => {
    const now = local("2026-09-25T02:30:00");
    expect(windowEdges("week", now)).toEqual(dayEdges(now).slice(-8));
    expect(windowEdges("week", now)[0]).toBe(local("2026-09-19T00:00:00"));
  });
});

describe("weekEdges — the weeks of the closings-by-type chart", () => {
  it("starts every week on a local Monday midnight and ends with the week holding now", () => {
    const now = local("2026-09-25T02:30:00");
    const edges = weekEdges(now);
    expect(edges).toHaveLength(9);
    expect(edges[7]).toBe(local("2026-09-21T00:00:00"));
    expect(edges[8]).toBe(local("2026-09-28T00:00:00"));
  });

  it("always gives 9 strictly increasing Monday edges with now inside the last week", () => {
    fc.assert(
      fc.property(arbitraryNow, (now) => {
        const edges = weekEdges(now);
        expect(edges).toHaveLength(9);
        expect(increasing(edges)).toBe(true);
        edges.forEach((edge) => expect(new Date(edge).getDay()).toBe(1));
        expect(edges[7]! <= now && now < edges[8]!).toBe(true);
      }),
    );
  });
});

describe("defaultAnalyticsRows", () => {
  it("places every section exactly once, each row's widths summing to 1", () => {
    const rows = defaultAnalyticsRows().rows;
    expect(rows.flatMap((row) => row.cells.map((cell) => cell.id)).sort()).toEqual([...SECTION_KINDS].sort());
    rows.forEach((row) => expect(row.cells.reduce((sum, cell) => sum + cell.weight, 0)).toBeCloseTo(1, 9));
  });

  it("opens on the week cut across every project", () => {
    expect(DEFAULT_FILTER).toEqual({ window: "week", projectIds: [] });
  });
});

describe("windowEdges — the all-time cut", () => {
  it("draws all time by the week, from the Monday of the first task's week through the week holding now", () => {
    const now = local("2026-09-25T02:30:00");
    const edges = windowEdges("all", now, local("2026-08-05T10:00:00"));
    expect(edges[0]).toBe(local("2026-08-03T00:00:00"));
    expect(edges[edges.length - 1]).toBe(local("2026-09-28T00:00:00"));
    expect(edges).toHaveLength(9);
    edges.forEach((edge) => expect(new Date(edge).getDay()).toBe(1));
  });

  it("draws the current week alone before any task exists", () => {
    const now = local("2026-09-25T02:30:00");
    expect(windowEdges("all", now)).toEqual([local("2026-09-21T00:00:00"), local("2026-09-28T00:00:00")]);
  });

  it("offers all time after the rolling cuts", () => {
    expect(ANALYTICS_WINDOWS).toEqual(["day", "week", "month", "all"]);
  });
});

describe("weekBreaksOf — where the charts of a cut mark a new week", () => {
  it("marks every Monday of the day columns", () => {
    const now = local("2026-09-25T02:30:00");
    const breaks = weekBreaksOf("month", windowEdges("month", now));
    expect(breaks.map((entry) => new Date(entry.mondayMs).getDate())).toEqual([31, 7, 14, 21]);
    breaks.forEach((entry) => expect(windowEdges("month", now)[entry.column]).toBe(entry.mondayMs));
  });

  it("marks nothing on hour columns and on week columns, which are weeks already", () => {
    const now = local("2026-09-21T12:00:00");
    expect(weekBreaksOf("day", windowEdges("day", now))).toEqual([]);
    expect(weekBreaksOf("all", windowEdges("all", now, local("2026-06-01T00:00:00")))).toEqual([]);
  });
});

describe("columnDays — how many days one column of a cut spans", () => {
  it("is an hour's share for the day cut, a day for week and month, a week for all time", () => {
    expect(columnDays("day")).toBeCloseTo(1 / 24, 12);
    expect(columnDays("week")).toBe(1);
    expect(columnDays("month")).toBe(1);
    expect(columnDays("all")).toBe(7);
  });
});

describe("the Gantt section", () => {
  it("stands in its own row at the bottom of the screen", () => {
    const rows = defaultAnalyticsRows().rows;
    expect(rows.at(-1)?.cells.map((cell) => cell.id)).toEqual(["gantt"]);
  });
});

describe("a layout saved before the Gantt", () => {
  it("gains the Gantt row and keeps its own sizes", () => {
    const defaults = defaultAnalyticsRows();
    const before = { rows: defaults.rows.filter((row) => row.id !== "timeline").map((row) => ({ ...row, height: row.height + 40 })) };
    const merged = mergeSaved(defaults, parseSaved(serializeLayout(before)));
    expect(merged.rows.map((row) => row.id)).toEqual(defaults.rows.map((row) => row.id));
    expect(merged.rows.at(-1)!.cells.map((cell) => cell.id)).toEqual(["gantt"]);
    expect(merged.rows[0]!.height).toBe(defaults.rows[0]!.height + 40);
  });
});
