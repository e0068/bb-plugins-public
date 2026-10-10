import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMPTY_FILTERS } from "../common/filter-state.js";
import { dayEdges, hourEdges } from "./closed-model";
import {
  ANALYTICS_WINDOWS,
  DEFAULT_FILTER,
  columnDays,
  weekBreaksOf,
  windowEdges,
} from "./default-dashboard";

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

describe("defaultAnalyticsRows", () => {
  it("opens on the week cut across every project", () => {
    expect(DEFAULT_FILTER).toEqual({ window: "week", filters: EMPTY_FILTERS });
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
