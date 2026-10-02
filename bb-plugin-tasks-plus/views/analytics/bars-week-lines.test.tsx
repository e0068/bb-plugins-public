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

const stacked = () => <StackedBars columns={COLUMNS} series={SERIES} columnLabel={(column) => `col ${column}`} ticks={[]} />;
const diverging = () => (
  <DivergingBars
    up={{ label: "Created", color: "#111", values: [1, 2, 0, 3, 1] }}
    down={{ label: "Closed", color: "#222", values: [0, 1, 1, 0, 2] }}
    columnLabel={(column) => `col ${column}`}
    ticks={[]}
  />
);

const marks = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-week-break]"));

describe("week lines on the column charts", () => {
  it("draws a line at each column that opens a week, with no date over the chart", () => {
    for (const chart of [stacked, diverging]) {
      const { container } = render(<WeekBreaksScope breaks={BREAKS}>{chart()}</WeekBreaksScope>);
      expect(marks(container).map((mark) => mark.closest("[data-column]")?.getAttribute("data-column"))).toEqual(["1", "4"]);
      expect(marks(container).map((mark) => mark.textContent)).toEqual(["", ""]);
      cleanup();
    }
  });

  it("draws nothing outside a scope", () => {
    for (const chart of [stacked, diverging]) {
      const { container } = render(chart());
      expect(marks(container)).toHaveLength(0);
      cleanup();
    }
  });

  it("lays the underlay under the columns", () => {
    const { container } = render(
      <StackedBars columns={COLUMNS} series={SERIES} columnLabel={(column) => `col ${column}`} ticks={[]} underlay={<div data-under />} overlay={<div data-over />} />,
    );
    const order = Array.from(container.querySelectorAll("[data-under], [data-column], [data-over]"), (node) =>
      node.hasAttribute("data-under") ? "under" : node.hasAttribute("data-over") ? "over" : "column",
    );
    expect(order[0]).toBe("under");
    expect(order.at(-1)).toBe("over");
  });
});
