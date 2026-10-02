// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DivergingBars, StackedBars, type BarSeries } from "./bars";

afterEach(cleanup);

const SERIES: BarSeries[] = [
  { id: "p", label: "Plugins", color: "#111" },
  { id: "q", label: "Quarry", color: "#222" },
];
// Column 0: 1 + 3, column 1: 2 + 0.
const COLUMNS = [
  [1, 3],
  [2, 0],
];

const dimmed = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-segment]"))
    .filter((segment) => segment.getAttribute("data-dimmed") === "true")
    .map((segment) => segment.getAttribute("data-segment"));

function renderBars(selected: { column: number; seriesId: string | null } | null = null) {
  const onSelect = vi.fn();
  const onSelectColumn = vi.fn();
  const view = render(<StackedBars columns={COLUMNS} series={SERIES} columnLabel={String} ticks={[]} selected={selected} onSelect={onSelect} onSelectColumn={onSelectColumn} />);
  return { ...view, onSelect, onSelectColumn };
}

describe("StackedBars — hover and pick", () => {
  it("lays no band behind a hovered column", () => {
    const { container } = renderBars();
    const column = container.querySelector('[data-column="0"]')!;
    fireEvent.mouseMove(column, { clientX: 1, clientY: 1 });
    expect(column.className).not.toContain("bg-state-hover");
  });

  it("dims every other segment while one is hovered", () => {
    const { container } = renderBars();
    fireEvent.mouseMove(container.querySelector('[data-segment="0:q"]')!, { clientX: 1, clientY: 1 });
    expect(dimmed(container)).toEqual(["0:p", "1:p"]);
  });

  it("dims the other columns while the empty part of a column is hovered, over what is picked", () => {
    const { container } = renderBars({ column: 1, seriesId: "p" });
    fireEvent.mouseMove(container.querySelector('[data-column="0"]')!, { clientX: 1, clientY: 1 });
    expect(dimmed(container)).toEqual(["1:p"]);
    fireEvent.mouseLeave(container.querySelector('[data-column="0"]')!);
    expect(dimmed(container)).toEqual(["0:p", "0:q"]);
  });

  it("picks the whole column by a click on its empty part, a segment by a click on it", () => {
    const { container, onSelect, onSelectColumn } = renderBars();
    fireEvent.click(container.querySelector('[data-column="0"]')!);
    expect(onSelectColumn).toHaveBeenCalledWith(0);
    fireEvent.click(container.querySelector('[data-segment="1:p"]')!);
    expect(onSelect).toHaveBeenCalledWith(1, "p");
    expect(onSelectColumn).toHaveBeenCalledTimes(1);
  });

  it("lights a whole picked column", () => {
    const { container } = renderBars({ column: 0, seriesId: null });
    expect(dimmed(container)).toEqual(["1:p"]);
  });
});

describe("DivergingBars — hover and pick", () => {
  const up = { id: "created", label: "Created", color: "red", values: [2, 0] };
  const down = { id: "closed", label: "Closed", color: "blue", values: [1, 3] };

  it("picks the whole column by a click beside its halves and lays no band behind it", () => {
    const onSelectColumn = vi.fn();
    const { container } = render(<DivergingBars up={up} down={down} columnLabel={String} ticks={[]} onSelect={vi.fn()} onSelectColumn={onSelectColumn} />);
    const column = container.querySelector('[data-column="1"]')!;
    fireEvent.mouseMove(column, { clientX: 1, clientY: 1 });
    expect(column.className).not.toContain("bg-state-hover");
    expect(dimmed(container)).toEqual(["0:created", "0:closed"]);
    fireEvent.click(column);
    expect(onSelectColumn).toHaveBeenCalledWith(1);
  });
});

describe("an empty column under the pointer", () => {
  it("dims nothing: a click there picks nothing", () => {
    const { container } = render(
      <StackedBars columns={[[1, 3], [0, 0]]} series={SERIES} columnLabel={String} ticks={[]} selected={null} onSelect={vi.fn()} onSelectColumn={vi.fn()} />,
    );
    fireEvent.mouseMove(container.querySelector('[data-column="1"]')!, { clientX: 1, clientY: 1 });
    expect(dimmed(container)).toEqual([]);
  });

  it("dims nothing on the diverging chart either", () => {
    const { container } = render(
      <DivergingBars up={{ id: "u", label: "U", color: "red", values: [2, 0] }} down={{ id: "d", label: "D", color: "blue", values: [1, 0] }} columnLabel={String} ticks={[]} onSelect={vi.fn()} onSelectColumn={vi.fn()} />,
    );
    fireEvent.mouseMove(container.querySelector('[data-column="1"]')!, { clientX: 1, clientY: 1 });
    expect(dimmed(container)).toEqual([]);
  });
});
