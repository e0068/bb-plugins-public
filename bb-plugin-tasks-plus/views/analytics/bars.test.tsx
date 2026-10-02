// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DivergingBars, StackedBars, type BarSeries } from "./bars";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SERIES: BarSeries[] = [
  { id: "p", label: "Plugins", color: "#111" },
  { id: "q", label: "Quarry", color: "#222" },
];
// Column 0: 1 + 3, column 1: nothing, column 2: 2 + 0.
const COLUMNS = [
  [1, 3],
  [0, 0],
  [2, 0],
];

function renderBars(onSelect = vi.fn()) {
  const view = render(
    <StackedBars
      columns={COLUMNS}
      series={SERIES}
      columnLabel={(column) => `col ${column}`}
      ticks={["start", "end"]}
      selected={null}
      onSelect={onSelect}
    />,
  );
  return { ...view, onSelect };
}

const stackHeight = (container: HTMLElement, column: number) =>
  (container.querySelector(`[data-column="${column}"] [data-stack]`) as HTMLElement | null)?.style.height;

describe("StackedBars", () => {
  it("scales each column's stack to its total against the tallest column", () => {
    const { container } = renderBars();
    expect(stackHeight(container, 0)).toBe("100%");
    expect(stackHeight(container, 2)).toBe("50%");
  });

  it("draws an empty column as a floor line with no segments", () => {
    const { container } = renderBars();
    expect(container.querySelectorAll('[data-column="1"] [data-segment]')).toHaveLength(0);
    expect(container.querySelector('[data-column="1"] [data-empty]')).not.toBeNull();
  });

  it("draws a segment for every non-zero value only", () => {
    const { container } = renderBars();
    expect(Array.from(container.querySelectorAll("[data-segment]")).map((node) => node.getAttribute("data-segment"))).toEqual([
      "0:p",
      "0:q",
      "2:p",
    ]);
  });

  it("reports the clicked segment's column and series", () => {
    const { container, onSelect } = renderBars();
    fireEvent.click(container.querySelector('[data-segment="0:q"]')!);
    expect(onSelect).toHaveBeenCalledWith(0, "q");
  });

  it("dims every segment but the selected one", () => {
    const { container } = render(
      <StackedBars columns={COLUMNS} series={SERIES} columnLabel={String} ticks={[]} selected={{ column: 0, seriesId: "p" }} onSelect={vi.fn()} />,
    );
    expect(container.querySelector('[data-segment="0:p"]')!.getAttribute("data-dimmed")).toBe("false");
    expect(container.querySelector('[data-segment="0:q"]')!.getAttribute("data-dimmed")).toBe("true");
  });

  it("draws segments nobody can pick as plain marks, not buttons", () => {
    render(<StackedBars columns={COLUMNS} series={SERIES} columnLabel={String} ticks={[]} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows, while hovered, a tooltip naming the column and every non-zero series with its value", () => {
    const { container } = renderBars();
    fireEvent.mouseMove(container.querySelector('[data-column="0"]')!, { clientX: 10, clientY: 10 });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("col 0");
    expect(tip.textContent).toContain("Plugins");
    expect(tip.textContent).toContain("Quarry");
    fireEvent.mouseLeave(container.querySelector('[data-column="0"]')!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the tooltip of a column at the right edge of the window inside it, 8px from the edge", () => {
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    const size = { width: 180, height: 90 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON: () => ({}),
    });
    const { container } = renderBars();
    fireEvent.mouseMove(container.querySelector('[data-column="2"]')!, { clientX: 990, clientY: 300 });
    const tip = screen.getByRole("tooltip");
    expect(parseFloat(tip.style.left) + size.width).toBeLessThanOrEqual(1000 - 8);
  });

  it("prints the ticks under the chart", () => {
    renderBars();
    expect(screen.getByText("start")).toBeTruthy();
    expect(screen.getByText("end")).toBeTruthy();
  });
});

describe("DivergingBars", () => {
  it("scales both sides against the largest value of either", () => {
    const { container } = render(
      <DivergingBars
        up={{ label: "Created", color: "#111", values: [4, 1] }}
        down={{ label: "Closed", color: "#222", values: [2, 0] }}
        columnLabel={String}
        ticks={[]}
      />,
    );
    const height = (side: string, column: number) =>
      (container.querySelector(`[data-column="${column}"] [data-side="${side}"]`) as HTMLElement | null)?.style.height;
    expect(height("up", 0)).toBe("100%");
    expect(height("down", 0)).toBe("50%");
    expect(height("up", 1)).toBe("25%");
    expect(height("down", 1)).toBeUndefined();
  });
});

describe("StackedBars — layers over the plot", () => {
  it("lays the underlay under the columns", () => {
    const { container } = render(
      <StackedBars
        columns={[[1], [2], [0], [3], [1]]}
        series={[{ id: "p", label: "Plugins", color: "#111" }]}
        columnLabel={(column) => `col ${column}`}
        ticks={[]}
        underlay={<div data-under />}
        overlay={<div data-over />}
      />,
    );
    const order = Array.from(container.querySelectorAll("[data-under], [data-column], [data-over]"), (node) =>
      node.hasAttribute("data-under") ? "under" : node.hasAttribute("data-over") ? "over" : "column",
    );
    expect(order[0]).toBe("under");
    expect(order.at(-1)).toBe("over");
  });
});
