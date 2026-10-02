// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GanttChart } from "../analytics/gantt-chart.js";
import { chartWindow } from "./chart-window.js";
import { dateTicks } from "./date-ticks.js";
import { BurndownChart } from "./subtask-stats.js";

afterEach(cleanup);

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Friday 2026-10-02, noon. */
const NOW = new Date(2026, 9, 2, 12).getTime();
const OPEN = [6, 6, 5, 4, 4, 3, 2, 1];
const ends = (count: number, stepMs = DAY) => Array.from({ length: count }, (_, i) => NOW - (count - 1 - i) * stepMs);
const span = (today: "left" | "center" | "right", period = 7, unit: "days" | "hours" = "days") =>
  chartWindow({ period, unit, today, nowMs: NOW, oldestMs: NOW - 30 * DAY, latestPlanMs: null });

const burndown = (window: { fromMs: number; toMs: number }, extra: Partial<Parameters<typeof BurndownChart>[0]> = {}) =>
  render(<BurndownChart open={OPEN} ends={ends(OPEN.length)} window={window} nowMs={NOW} ticks={[]} showDates={false} forecastMs={null} {...extra} />)
    .container;
/** Where across the chart an svg x falls, 0 to 1. */
const across = (container: HTMLElement, x: string | null) => Number(x) / Number(container.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2]);

describe("a card's burndown drawn over the card's window", () => {
  it("stands today in the exact middle with today centered", () => {
    const container = burndown(span("center"));
    expect(across(container, container.querySelector("[data-burndown-today]")!.getAttribute("x1"))).toBeCloseTo(0.5);
  });

  it("stands today where the card's Gantt stands it, over the same window", () => {
    for (const today of ["center", "left"] as const) {
      const window = { ...span(today), fromMs: span(today).fromMs - 2 * HOUR };
      const container = burndown(window);
      const row = { taskId: "T", key: "T-1", projectId: "P", parentTaskId: null, title: "T", status: "in_progress" as const, startDate: null, dueDate: null, createdMs: NOW - DAY, doneMs: null, segments: [{ status: "in_progress" as const, fromMs: NOW - DAY, toMs: NOW }] };
      const gantt = render(<GanttChart rows={[row]} fromMs={window.fromMs} toMs={window.toMs} todayMs={NOW} mode="fact" compact />).container;
      const ganttAt = Number.parseFloat(gantt.querySelector<HTMLElement>("[data-gantt-today]")!.style.left) / 100;
      expect(across(container, container.querySelector("[data-burndown-today]")!.getAttribute("x1"))).toBeCloseTo(ganttAt);
      cleanup();
    }
  });

  it("puts each read where its moment falls, the last one at today", () => {
    const window = span("center");
    const container = burndown(window);
    const points = container.querySelector("polyline")!.getAttribute("points")!.split(" ");
    expect(across(container, points.at(-1)!.split(",")[0]!)).toBeCloseTo(0.5);
    expect(across(container, points.at(-2)!.split(",")[0]!)).toBeCloseTo((NOW - DAY - window.fromMs) / (window.toMs - window.fromMs));
  });

  it("draws no today line with today on an edge, and runs the trend to the window's end past today", () => {
    expect(burndown(span("right")).querySelector("[data-burndown-today]")).toBeNull();
    cleanup();
    const container = burndown(span("center"));
    expect(across(container, container.querySelector("[data-burndown-trend]")!.getAttribute("x2"))).toBeCloseTo(1);
  });

  it("holds the trend inside the chart ahead of today", () => {
    const container = burndown(span("left", 14));
    const trend = container.querySelector("[data-burndown-trend]")!;
    expect(Number(trend.getAttribute("y1"))).toBeGreaterThanOrEqual(0);
    expect(Number(trend.getAttribute("y2"))).toBeGreaterThanOrEqual(0);
  });

  it("names how far back the window looks — days, hours, a first date — and today when it opens at today", () => {
    expect(burndown(span("right")).textContent).toContain("7 d ago");
    cleanup();
    expect(burndown(span("right", 6, "hours"), { ends: ends(OPEN.length, HOUR) }).textContent).toContain("6 h ago");
    cleanup();
    expect(burndown({ fromMs: NOW - 60 * DAY, toMs: NOW }).textContent).toContain(`since ${new Date(NOW - 60 * DAY).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
    cleanup();
    expect(burndown(span("left")).textContent).toContain("today");
  });
});

describe("the dates under a card's burndown", () => {
  it("writes the dates it is handed under the chart, a line at each, and none when the card writes them elsewhere", () => {
    const window = span("center");
    const ticks = dateTicks(window, "many");
    const shown = burndown(window, { ticks, showDates: true });
    expect(Array.from(shown.querySelectorAll("[data-date-label]")).map((label) => label.textContent)).toEqual(
      ticks.map((tick) => new Date(tick.ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
    );
    expect(shown.querySelectorAll("[data-date-grid]")).toHaveLength(ticks.length);
    cleanup();
    const hidden = burndown(window, { ticks, showDates: false });
    expect(hidden.querySelectorAll("[data-date-label]")).toHaveLength(0);
    expect(hidden.querySelectorAll("[data-date-grid]")).toHaveLength(ticks.length);
  });

  it("writes a time of day over hours", () => {
    const window = span("center", 6, "hours");
    const ticks = dateTicks(window, "some");
    const container = burndown(window, { ends: ends(OPEN.length, HOUR), ticks, showDates: true });
    expect(container.querySelector("[data-date-label]")!.textContent).toBe(
      new Date(ticks[0]!.ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    );
  });
});

describe("the forecast under a card's burndown", () => {
  it("says the time left in minutes, hours or days, whatever the period counts", () => {
    const said = (forecastMs: number) => {
      const text = burndown(span("right"), { forecastMs }).textContent;
      cleanup();
      return text;
    };
    expect(said(10 * 60_000)).toContain("1 open · ~10 min left");
    expect(said(3 * HOUR)).toContain("1 open · ~3 h left");
    expect(said(2 * DAY)).toContain("1 open · ~2 d left");
    expect(said(1.5 * DAY)).toContain("1 open · ~2 d left");
  });
});
