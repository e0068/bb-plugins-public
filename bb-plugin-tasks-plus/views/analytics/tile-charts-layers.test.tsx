// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { TileChart, tileLegend } from "./tile-charts";

afterEach(cleanup);

const answer = (values: number[][]): TileAnswer => ({
  columns: values.map((_, index) => ({ key: String(index), label: `C${index}` })),
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

const display = { legend: "bottom" as const, xLabels: true, yLabels: true, grid: { x: 1, y: 1 }, trend: false };
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("TileChart — the grid lies under the chart", () => {
  it("puts the grid lines before the columns", () => {
    const { container } = render(
      <TileChart tile={newTile("t", { breakdown: null, display })} answer={answer([[3], [5]])} edges={[0, 1, 2]} unit="day" nowMs={2} onOpenTask={() => {}} />,
    );
    const line = container.querySelector("[data-grid-y]")!;
    expect(before(line, container.querySelector("[data-column]")!)).toBe(true);
  });

  it("puts the grid lines before the line chart's lines", () => {
    const { container } = render(
      <TileChart tile={newTile("t", { type: "line", breakdown: null, display })} answer={answer([[3], [5]])} edges={[0, 1, 2]} unit="day" nowMs={2} onOpenTask={() => {}} />,
    );
    expect(before(container.querySelector("[data-grid-y]")!, container.querySelector("[data-line]")!)).toBe(true);
  });
});

describe("tileLegend — one legend per chart", () => {
  it("gives a ring no second legend: the ring lists its slices itself", () => {
    const ring = newTile("t", { type: "ring", x: "project", breakdown: null });
    expect(tileLegend(ring, answer([[3], [5]]), { status: () => "#000", series: () => "#000" } as never)).toEqual([]);
  });
});
