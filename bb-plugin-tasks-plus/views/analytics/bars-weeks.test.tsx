// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DivergingBars, StackedBars, WeekBreaksScope, type BarSeries } from "./bars";

afterEach(cleanup);

const SERIES: BarSeries[] = [{ id: "p", label: "Plugins", color: "#111" }];
const COLUMNS = [[1], [2], [0], [3], [1]];
const BREAKS = [
  { column: 1, label: "Sep 21" },
  { column: 4, label: "Sep 28" },
];

const stacked = () => (
  <StackedBars columns={COLUMNS} series={SERIES} columnLabel={(column) => `col ${column}`} ticks={[]} />
);
const diverging = () => (
  <DivergingBars
    up={{ label: "Created", color: "#111", values: [1, 2, 0, 3, 1] }}
    down={{ label: "Closed", color: "#222", values: [0, 1, 1, 0, 2] }}
    columnLabel={(column) => `col ${column}`}
    ticks={[]}
  />
);

const breakColumns = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-week-break]"), (mark) => mark.closest("[data-column]")?.getAttribute("data-column"));

describe("week breaks on the column charts", () => {
  it("marks each column that opens a week, with the week's label, on both chart kinds", () => {
    for (const chart of [stacked, diverging]) {
      const { container } = render(<WeekBreaksScope breaks={BREAKS}>{chart()}</WeekBreaksScope>);
      expect(breakColumns(container)).toEqual(["1", "4"]);
      expect(Array.from(container.querySelectorAll("[data-week-break]"), (mark) => mark.textContent)).toEqual(["Sep 21", "Sep 28"]);
      cleanup();
    }
  });

  it("marks nothing outside a scope — the hourly and weekly charts stay plain", () => {
    for (const chart of [stacked, diverging]) {
      const { container } = render(chart());
      expect(container.querySelectorAll("[data-week-break]")).toHaveLength(0);
      cleanup();
    }
  });
});
