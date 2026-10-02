// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { dateTicks } from "../board/date-ticks.js";
import { GanttChart } from "./gantt-chart.js";

afterEach(cleanup);

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 2, 12).getTime();
const row = {
  taskId: "T",
  key: "T-1",
  projectId: "P",
  parentTaskId: null,
  title: "T",
  status: "in_progress" as const,
  startDate: null,
  dueDate: null,
  createdMs: NOW - 10 * HOUR,
  doneMs: null,
  segments: [{ status: "in_progress" as const, fromMs: NOW - 5 * HOUR, toMs: NOW }],
};

describe("a card's Gantt lined at the card's dates", () => {
  it("stands a line at each date it is handed instead of at Mondays", () => {
    const window = { fromMs: NOW - 6 * HOUR, toMs: NOW + 6 * HOUR };
    const ticks = dateTicks(window, "some");
    const { container } = render(<GanttChart rows={[row]} {...window} todayMs={NOW} mode="fact" compact ticks={ticks} />);
    const lines = Array.from(container.querySelectorAll<HTMLElement>("[data-date-grid]"));
    expect(lines.map((line) => line.style.left)).toEqual(ticks.map((tick) => `${tick.at * 100}%`));
    expect(container.querySelectorAll("[data-week-break]")).toHaveLength(0);
  });
});
