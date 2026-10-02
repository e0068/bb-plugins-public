// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tile, TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { TileCard, type TileCardProps } from "./tile-card";

window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const answer: TileAnswer = {
  columns: [
    { key: "todo", label: "todo" },
    { key: "done", label: "done" },
  ],
  series: [{ key: "value", label: "Tasks" }],
  values: [[2], [1]],
  cells: [[["TSK-1", "TSK-2"]], [["TSK-3"]]],
  titles: { "TSK-1": "One", "TSK-2": "Two", "TSK-3": "Three" },
  switchValues: [],
  total: 3,
  rows: [],
  figures: {},
  projects: [],
  logStartMs: null,
};

const tile = (contents: number | undefined, type: Tile["type"] = "columns"): Tile => {
  const base = newTile("t", { title: "By status", type, x: "status", breakdown: null });
  return { ...base, display: contents === undefined ? base.display : { ...base.display, contents } };
};

const props = (patch: Partial<TileCardProps> = {}): TileCardProps => ({
  tile: tile(0.6),
  answer,
  error: null,
  edges: [0, 1],
  unit: "day",
  nowMs: 1,
  picked: null,
  editing: false,
  onPick: vi.fn(),
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onOpenTask: vi.fn(),
  onSplit: vi.fn(),
  contents: ({ pick, heading }) => (
    <div data-contents data-pick={JSON.stringify(pick)}>
      {heading}
    </div>
  ),
  ...patch,
});

const pick = () => JSON.parse(document.querySelector("[data-contents]")!.getAttribute("data-pick")!);
const heading = () => document.querySelector("[data-contents]")!.textContent;

describe("TileCard — the table of a segment under the chart", () => {
  it("leaves segments unclickable and shows no table while the setting is off", () => {
    const { container } = render(<TileCard {...props({ tile: tile(undefined) })} />);
    expect(container.querySelector("[data-segment]")?.tagName).not.toBe("BUTTON");
    expect(container.querySelector("[data-contents]")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("heads the table with every task of the chart until a segment is picked", () => {
    render(<TileCard {...props()} />);
    expect(pick()).toBeNull();
    expect(heading()).toBe("All tasks");
  });

  it("narrows the table to a clicked segment, and a click beside the segments widens it back", () => {
    const { container } = render(<TileCard {...props()} />);
    fireEvent.click(container.querySelector('[data-segment="1:value"]')!);
    expect(pick()).toEqual({ column: 1, seriesId: "value" });
    expect(heading()).toBe("Tasks · Done");
    fireEvent.click(container.querySelector("[data-chart-pane]")!);
    expect(pick()).toBeNull();
  });

  it("drops the pick on a second click on the same segment", () => {
    const { container } = render(<TileCard {...props()} />);
    fireEvent.click(container.querySelector('[data-segment="0:value"]')!);
    fireEvent.click(container.querySelector('[data-segment="0:value"]')!);
    expect(pick()).toBeNull();
  });

  it("gives the chart the tile's share of the height and moves the divider by the keyboard", () => {
    const onSplit = vi.fn();
    render(<TileCard {...props({ onSplit })} />);
    const divider = screen.getByRole("separator", { name: "Chart and contents" });
    expect(divider.getAttribute("aria-valuenow")).toBe("60");
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(onSplit).toHaveBeenLastCalledWith(0.55);
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(onSplit).toHaveBeenLastCalledWith(0.65);
  });

  it("stops at its bound: a press past it saves nothing", () => {
    const onSplit = vi.fn();
    render(<TileCard {...props({ tile: tile(0.2), onSplit })} />);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Chart and contents" }), { key: "ArrowUp" });
    expect(onSplit).not.toHaveBeenCalled();
  });

  it("saves nothing for a click on the divider that does not move it", () => {
    const onSplit = vi.fn();
    render(<TileCard {...props({ onSplit })} />);
    const divider = screen.getByRole("separator", { name: "Chart and contents" });
    fireEvent.pointerDown(divider, { pointerId: 1, clientY: 10 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientY: 10 });
    expect(onSplit).not.toHaveBeenCalled();
  });

  it("picks a ring's slice — a whole column — by its arc", () => {
    const { container } = render(<TileCard {...props({ tile: tile(0.6, "ring") })} />);
    fireEvent.click(container.querySelector('[data-arc="done"]')!);
    expect(pick()).toEqual({ column: 1, seriesId: null });
  });

  it("picks a bar's segment", () => {
    const { container } = render(<TileCard {...props({ tile: tile(0.6, "bars") })} />);
    fireEvent.click(container.querySelector('[data-segment="0:value"]')!);
    expect(pick()).toEqual({ column: 0, seriesId: "value" });
  });
});

describe("TileCard — a whole column or row picked", () => {
  it("picks a whole column by a click on its empty part", () => {
    const { container } = render(<TileCard {...props()} />);
    fireEvent.click(container.querySelector('[data-column="0"]')!);
    expect(pick()).toEqual({ column: 0, seriesId: null });
    expect(heading()).toBe("To do");
  });

  it("picks a whole bar row by a click beside its segments", () => {
    const { container } = render(<TileCard {...props({ tile: tile(0.6, "bars") })} />);
    fireEvent.click(container.querySelectorAll("[data-bar-row]")[1]!);
    expect(pick()).toEqual({ column: 1, seriesId: null });
  });
});

describe("TileCard — a pick across answers", () => {
  it("keeps the pick when a new answer still has its column and series, by their keys", () => {
    const { container, rerender } = render(<TileCard {...props()} />);
    fireEvent.click(container.querySelector('[data-segment="1:value"]')!);
    rerender(<TileCard {...props({ answer: { ...answer, values: [[3], [1]] } })} />);
    expect(pick()).toEqual({ column: 1, seriesId: "value" });
    rerender(<TileCard {...props({ answer: { ...answer, columns: [{ key: "new", label: "new" }, ...answer.columns], values: [[1], [2], [1]], cells: [[[]], ...answer.cells] } })} />);
    expect(pick()).toEqual({ column: 2, seriesId: "value" });
  });

  it("drops the pick when the new answer has no such column", () => {
    const { container, rerender } = render(<TileCard {...props()} />);
    fireEvent.click(container.querySelector('[data-segment="1:value"]')!);
    rerender(<TileCard {...props({ answer: { ...answer, columns: [answer.columns[0]!], values: [[2]], cells: [answer.cells[0]!] } })} />);
    expect(pick()).toBeNull();
  });
});

describe("TileCard — a pick on a moving window", () => {
  const overTime = { ...tile(0.6), x: "time" as const };
  const byHour = { ...answer, columns: [{ key: "0", label: "0" }, { key: "1", label: "1" }] };

  it("drops the pick on a time axis when the window moves on: the same column is another time now", () => {
    const { container, rerender } = render(<TileCard {...props({ tile: overTime, answer: byHour, edges: [0, 1, 2] })} />);
    fireEvent.click(container.querySelector('[data-segment="1:value"]')!);
    rerender(<TileCard {...props({ tile: overTime, answer: { ...byHour }, edges: [0, 1, 2] })} />);
    expect(pick()).toEqual({ column: 1, seriesId: "value" });
    rerender(<TileCard {...props({ tile: overTime, answer: { ...byHour }, edges: [1, 2, 3] })} />);
    expect(pick()).toBeNull();
  });

  it("keeps a category's pick when the window moves on", () => {
    const { container, rerender } = render(<TileCard {...props({ edges: [0, 1, 2] })} />);
    fireEvent.click(container.querySelector('[data-segment="1:value"]')!);
    rerender(<TileCard {...props({ answer: { ...answer }, edges: [1, 2, 3] })} />);
    expect(pick()).toEqual({ column: 1, seriesId: "value" });
  });
});
