// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RowBoard } from "./row-board";
import type { RowLayout } from "./row-layout";

const LAYOUT: RowLayout = {
  rows: [
    { id: "top", height: 200, minHeight: 100, cells: [{ id: "a", weight: 0.5 }, { id: "b", weight: 0.5 }] },
    { id: "bottom", height: 300, minHeight: 100, cells: [{ id: "c", weight: 1 }] },
  ],
};

// jsdom lays nothing out: give every row a 1000px width and its own height.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = Number(this.dataset.testHeight ?? 0);
    return { width: 1000, height, top: 0, left: 0, right: 1000, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBoard(onChange = vi.fn(), stacked = false) {
  const view = render(
    <RowBoard layout={LAYOUT} stacked={stacked} onChange={onChange} renderCell={(id) => <div data-testid={`cell-${id}`}>{id}</div>} />,
  );
  return { ...view, onChange };
}

const drag = (handle: Element, from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: to.x, clientY: to.y, pointerId: 1 });
};

describe("RowBoard", () => {
  it("renders every section in its row", () => {
    renderBoard();
    expect(screen.getByTestId("cell-a")).toBeTruthy();
    expect(screen.getByTestId("cell-c")).toBeTruthy();
  });

  it("puts a width splitter between the sections of a row and a height splitter under every row", () => {
    const { container } = renderBoard();
    expect(container.querySelectorAll('[data-splitter="width"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-splitter="height"]')).toHaveLength(2);
  });

  it("moves width between neighbours by a horizontal drag and reports the layout once, on release", () => {
    const { container, onChange } = renderBoard();
    drag(container.querySelector('[data-splitter="width"]')!, { x: 500, y: 0 }, { x: 600, y: 40 });
    expect(onChange).toHaveBeenCalledTimes(1);
    const top = onChange.mock.calls[0]![0].rows[0];
    // 100px of a 1000px row less its one 12px splitter.
    const moved = 100 / (1000 - 12);
    expect(top.cells[0].weight).toBeCloseTo(0.5 + moved, 9);
    expect(top.cells[1].weight).toBeCloseTo(0.5 - moved, 9);
    expect(top.height).toBe(200);
  });

  it("changes a row's height by a vertical drag of the splitter under it, nothing else", () => {
    const { container, onChange } = renderBoard();
    const row = container.querySelector('[data-row="top"]') as HTMLElement;
    row.dataset.testHeight = "200";
    drag(container.querySelectorAll('[data-splitter="height"]')[0]!, { x: 0, y: 300 }, { x: 80, y: 350 });
    const next = onChange.mock.calls[0]![0];
    expect(next.rows[0].height).toBe(250);
    expect(next.rows[0].cells).toEqual(LAYOUT.rows[0]!.cells);
    expect(next.rows[1]).toEqual(LAYOUT.rows[1]);
  });

  it("resizes the last row from its own height, not from the space it stretches over", () => {
    const { container, onChange } = renderBoard();
    const row = container.querySelector('[data-row="bottom"]') as HTMLElement;
    row.dataset.testHeight = "700";
    drag(container.querySelectorAll('[data-splitter="height"]')[1]!, { x: 0, y: 900 }, { x: 0, y: 850 });
    expect(onChange.mock.calls[0]![0].rows[1].height).toBe(250);
  });

  it("does nothing when a section itself is pressed and dragged", () => {
    const { onChange } = renderBoard();
    drag(screen.getByTestId("cell-a"), { x: 10, y: 10 }, { x: 300, y: 300 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stacks the sections without width splitters on a narrow screen", () => {
    const { container } = renderBoard(vi.fn(), true);
    expect(container.querySelectorAll('[data-splitter="width"]')).toHaveLength(0);
    expect(screen.getByTestId("cell-b")).toBeTruthy();
  });
});
