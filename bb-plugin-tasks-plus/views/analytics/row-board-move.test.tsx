// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowBoard } from "./row-board";
import type { RowLayout } from "./row-layout";

window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

afterEach(cleanup);

const LAYOUT: RowLayout = {
  rows: [
    { id: "r1", height: 100, minHeight: 60, cells: [{ id: "a", weight: 0.5 }, { id: "b", weight: 0.5 }] },
    { id: "r2", height: 100, minHeight: 60, cells: [{ id: "c", weight: 1 }] },
  ],
};

/** jsdom lays nothing out: rows and cells sit where these boxes say. */
const BOXES: Record<string, { left: number; top: number; right: number; bottom: number }> = {
  r1: { left: 0, top: 0, right: 200, bottom: 100 },
  r2: { left: 0, top: 112, right: 200, bottom: 212 },
  a: { left: 0, top: 0, right: 100, bottom: 100 },
  b: { left: 100, top: 0, right: 200, bottom: 100 },
  c: { left: 0, top: 112, right: 200, bottom: 212 },
};
Element.prototype.getBoundingClientRect = function (this: Element) {
  const id = (this as HTMLElement).dataset.row ?? (this as HTMLElement).dataset.cell;
  const box = (id && BOXES[id]) || { left: 0, top: 0, right: 0, bottom: 0 };
  return { ...box, x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, toJSON: () => box } as DOMRect;
};

const board = (onChange: (next: RowLayout) => void) =>
  render(
    <RowBoard
      layout={LAYOUT}
      stacked={false}
      onChange={onChange}
      renderCell={(id) => (
        <section>
          <header data-tile-handle>{id}</header>
          <button type="button">act {id}</button>
        </section>
      )}
    />,
  );

describe("RowBoard — moving a tile by its header", () => {
  it("moves the tile where it is dropped", () => {
    const onChange = vi.fn();
    const { getByText } = board(onChange);
    fireEvent.pointerDown(getByText("b"), { clientX: 150, clientY: 50, button: 0 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 150 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 150 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].rows.map((row: RowLayout["rows"][number]) => row.cells.map((cell) => cell.id))).toEqual([["a"], ["c", "b"]]);
  });

  it("leaves a click on the header alone, and a press on a button inside the tile", () => {
    const onChange = vi.fn();
    const { getByText } = board(onChange);
    fireEvent.pointerDown(getByText("b"), { clientX: 150, clientY: 50, button: 0 });
    fireEvent.pointerUp(window, { clientX: 151, clientY: 51 });
    fireEvent.pointerDown(getByText("act a"), { clientX: 20, clientY: 50, button: 0 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 150 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 150 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
