// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Tile, TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { TileChart } from "./tile-charts";

afterEach(cleanup);

const answer = (values: number[][], series = [{ key: "value", label: "Tasks" }]): TileAnswer => ({
  columns: values.map((_, index) => ({ key: String(index), label: "" })),
  series,
  values,
  cells: values.map((row) => row.map(() => [])),
  titles: {},
  switchValues: [],
  total: 1,
  rows: [],
  figures: {},
  projects: [],
  logStartMs: null,
});

const labelled = (patch: Partial<Tile>, yLabels: boolean): Tile => {
  const base = newTile("t", { breakdown: null, ...patch });
  return { ...base, display: { ...base.display, yLabels, grid: { x: null, y: 1 } } };
};

const draw = (tile: Tile, data: TileAnswer) => render(<TileChart tile={tile} answer={data} edges={[0, 1, 2]} unit="day" nowMs={2} onOpenTask={() => {}} />).container;

/** The labels stand in a gutter of their own beside the plot box — never inside it, over or under the marks. */
function expectGutter(container: HTMLElement) {
  const labels = Array.from(container.querySelectorAll("[data-y-label]"));
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((label) => label.closest("[data-y-axis]") !== null && label.closest("[data-plot]") === null)).toBe(true);
  const axis = container.querySelector("[data-y-axis]")!;
  const plot = container.querySelector("[data-plot]")!;
  expect(axis.contains(plot) || plot.contains(axis)).toBe(false);
}

describe("TileChart — Y labels move the plot aside, as X labels do", () => {
  it("gives the columns' labels a gutter of their own", () => {
    expectGutter(draw(labelled({}, true), answer([[3], [5]])));
  });

  it("gives the created/closed columns' labels a gutter of their own", () => {
    const series = [
      { key: "created", label: "Created" },
      { key: "closed", label: "Closed" },
    ];
    expectGutter(draw(labelled({ y: { metric: "createdClosed", field: null } }, true), answer([[3, 1], [5, 2]], series)));
  });

  it("gives the line's labels a gutter of their own", () => {
    expectGutter(draw(labelled({ type: "line" }, true), answer([[3], [5]])));
  });

  it("leaves no gutter when the labels are off", () => {
    expect(draw(labelled({}, false), answer([[3], [5]])).querySelector("[data-y-axis]")).toBeNull();
  });
});
