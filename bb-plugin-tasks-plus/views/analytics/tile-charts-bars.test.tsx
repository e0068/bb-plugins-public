// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tile, TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { TileChart } from "./tile-charts";

afterEach(cleanup);

const answer: TileAnswer = {
  columns: ["xs", "s", "m", "l"].map((key) => ({ key, label: key })),
  series: [{ key: "value", label: "Tasks" }],
  values: [[1], [2], [3], [4]],
  cells: [[[]], [[]], [[]], [[]]],
  titles: {},
  switchValues: [],
  total: 10,
  rows: [],
  figures: {},
  projects: [],
  logStartMs: null,
};

const bars = (display: Partial<Tile["display"]>): Tile => {
  const base = newTile("t", { type: "bars", x: "estimate", breakdown: null });
  return { ...base, display: { ...base.display, ...display } };
};

const draw = (tile: Tile) => render(<TileChart tile={tile} answer={answer} edges={[0, 1]} unit="day" nowMs={1} onOpenTask={() => {}} />).container;

describe("TileChart — bars", () => {
  it("names its rows by X axis labels and prints their values by Y axis labels", () => {
    const both = draw(bars({ xLabels: true, yLabels: true }));
    expect(both.querySelectorAll("[data-bar-label]")).toHaveLength(4);
    expect(both.querySelectorAll("[data-bar-value]")).toHaveLength(4);
    cleanup();
    const none = draw(bars({ xLabels: false, yLabels: false }));
    expect(none.querySelectorAll("[data-bar-label]")).toHaveLength(0);
    expect(none.querySelectorAll("[data-bar-value]")).toHaveLength(0);
  });

  it("draws a line between rows every N rows across", () => {
    expect(draw(bars({ grid: { x: 2, y: null } })).querySelectorAll("[data-grid-x]")).toHaveLength(1);
  });

  it("draws a line up the bars every step of the value", () => {
    expect(draw(bars({ grid: { x: null, y: 1 } })).querySelectorAll("[data-grid-y]")).toHaveLength(4);
  });

  it("shares the height between its rows", () => {
    const grid = draw(bars({})).querySelector<HTMLElement>("[data-bar-grid]")!;
    expect(grid.style.gridTemplateRows).toBe("repeat(4, minmax(20px, 1fr))");
  });
});

describe("TileChart — columns", () => {
  it("draws a column per answer column, and reports a clicked segment only to a listener", () => {
    const tile = newTile("t", { x: "estimate", breakdown: null });
    const marks = render(<TileChart tile={tile} answer={answer} edges={[0, 1]} unit="day" nowMs={1} onOpenTask={() => {}} />).container;
    expect(marks.querySelectorAll("[data-column]")).toHaveLength(4);
    expect(marks.querySelector('[data-segment="2:value"]')!.tagName).toBe("SPAN");
    cleanup();
    const onSelect = vi.fn();
    const buttons = render(<TileChart tile={tile} answer={answer} edges={[0, 1]} unit="day" nowMs={1} onOpenTask={() => {}} onSelect={onSelect} />).container;
    fireEvent.click(buttons.querySelector('[data-segment="2:value"]')!);
    expect(onSelect).toHaveBeenCalledWith({ column: 2, seriesId: "value" });
  });
});
