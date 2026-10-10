// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tile, TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { TileChart } from "./tile-charts";

afterEach(cleanup);

const NOW = new Date(2026, 9, 8).getTime();
const EDGES = Array.from({ length: 4 }, (_, day) => new Date(2026, 9, 5 + day).getTime());

const answer = (patch: Partial<TileAnswer> = {}): TileAnswer => ({
  columns: [
    { key: "0", label: "" },
    { key: "1", label: "" },
    { key: "2", label: "" },
  ],
  series: [
    { key: "todo", label: "todo" },
    { key: "done", label: "done" },
  ],
  values: [
    [2, 3],
    [5, 0],
    [10, 10],
  ],
  cells: [
    [["TSK-1", "TSK-2"], ["TSK-3"]],
    [["TSK-4"], []],
    [["TSK-5"], ["TSK-6"]],
  ],
  titles: { "TSK-1": "One", "TSK-2": "Two", "TSK-3": "Three", "TSK-4": "Four", "TSK-5": "Five", "TSK-6": "Six" },
  switchValues: [],
  total: 6,
  rows: [],
  figures: {},
  projects: [],
  logStartMs: null,
  ...patch,
});

const draw = (tile: Tile, data: TileAnswer = answer(), onOpenTask = vi.fn()) =>
  render(<TileChart tile={tile} answer={data} edges={EDGES} unit="day" nowMs={NOW} onOpenTask={onOpenTask} />);

describe("TileChart — columns", () => {
  it("lays a grid line every step of the value up to the top", () => {
    const tile = newTile("t", { display: { legend: "bottom", xLabels: true, yLabels: true, grid: { x: null, y: 5 }, trend: false } });
    const { container } = draw(tile);
    expect(container.querySelectorAll("[data-grid-y]")).toHaveLength(4);
  });

  it("marks every N-th column with a line across", () => {
    const tile = newTile("t", { display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: 1, y: null }, trend: false } });
    const { container } = draw(tile);
    expect(container.querySelectorAll("[data-grid-x]")).toHaveLength(2);
  });
});

describe("TileChart — other types", () => {
  it("draws an arc per category on a ring, with its total in the middle", () => {
    const { container } = draw(newTile("t", { type: "ring", x: "status" }));
    expect(container.querySelectorAll("[data-arc]")).toHaveLength(3);
    expect(screen.getByText("30")).toBeTruthy();
  });

  it("draws a pivot table with totals by row and by column", () => {
    draw(newTile("t", { type: "table", x: "status" }));
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.getAllByText("Total")).toHaveLength(2);
  });

  it("draws a line per series", () => {
    const { container } = draw(newTile("t", { type: "line" }));
    expect(container.querySelectorAll("[data-line]")).toHaveLength(2);
  });

  it("says under each sum how many closed tasks carry it, and sets the cost against the budget of the same tasks", () => {
    draw(
      newTile("t", { type: "big", figures: ["budget", "cost", "actual"] }),
      answer({
        figures: { closed: 4, budget: 50, cost: 12.5, actual: 30 },
        sums: { carriers: { planned: 4, actual: 1, budget: 4, cost: 1, limit: 4 }, paired: { cost: 12.5, budget: 25 } },
      }),
    );
    expect(screen.getByText("4 of 4 closed")).toBeTruthy();
    expect(screen.getByText("1 of 4 closed · 50% of their budget")).toBeTruthy();
    expect(screen.getByText("1 of 4 closed")).toBeTruthy();
  });

  it("prints the picked figures as the strip did", () => {
    draw(newTile("t", { type: "big", figures: ["open", "cost"] }), answer({ figures: { open: 7, cost: 12.5, budget: 50 }, total: 9 }));
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("of 9")).toBeTruthy();
    expect(screen.queryByText(/of budget/)).toBeNull();
  });

  it("blames the filter when a filtered tile comes out empty", () => {
    draw(newTile("t", { conditions: [{ field: "status", op: "eq", value: "done" }] }), answer({ values: [[0, 0], [0, 0], [0, 0]] }));
    expect(screen.getByText("No tasks match this chart's filter.")).toBeTruthy();
  });

  it("names the period, not a filter, when a tile without one comes out empty", () => {
    draw(newTile("t"), answer({ values: [[0, 0], [0, 0], [0, 0]] }));
    expect(screen.getByText("Nothing happened in this period.")).toBeTruthy();
  });
});
