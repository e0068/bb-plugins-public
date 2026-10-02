// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GRID_LINES_MAX } from "../../shared/analytics-tile.js";
import type { TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { TileChart } from "./tile-charts";

afterEach(cleanup);

const DAY = 86_400_000;

const answer = (values: number[][]): TileAnswer => ({
  columns: values.map((_, index) => ({ key: String(index), label: "" })),
  series: [{ key: "value", label: "Tasks" }],
  values,
  cells: values.map(() => [[]]),
  titles: {},
  switchValues: [],
  total: 1,
  rows: [],
  figures: {},
  projects: [],
  logStartMs: null,
});

const grid = (y: number) => ({ legend: "bottom" as const, xLabels: true, yLabels: true, grid: { x: null, y }, trend: false });

describe("TileChart — grid lines up", () => {
  it("never draws more than the cap, however fine the step", () => {
    const { container } = render(
      <TileChart tile={newTile("t", { y: { metric: "sum", field: "cost" }, display: grid(0.01) })} answer={answer([[5000], [9000]])} edges={[0, 1, 2]} unit="day" nowMs={2} onOpenTask={() => {}} />,
    );
    expect(container.querySelectorAll("[data-grid-y]").length).toBeLessThanOrEqual(GRID_LINES_MAX);
  });

  it("reads a cycle tile's step in days", () => {
    const { container } = render(
      <TileChart tile={newTile("t", { y: { metric: "cycle", field: null }, breakdown: null, display: grid(1) })} answer={answer([[2 * DAY, 2 * DAY]])} edges={[0, 1]} unit="day" nowMs={1} onOpenTask={() => {}} />,
    );
    expect(container.querySelectorAll("[data-grid-y]").length).toBe(4);
  });
});
