// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CELL_KEYS_MAX } from "../../shared/analytics-tile.js";
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
  ...patch,
});

const listed = () => Array.from(document.querySelectorAll("[data-segment-contents] [data-task-key]")).map((row) => row.getAttribute("data-task-key"));

describe("TileCard — segment contents", () => {
  it("leaves segments unclickable and lists nothing while the setting is off", () => {
    const { container } = render(<TileCard {...props({ tile: tile(undefined) })} />);
    expect(container.querySelector("[data-segment]")?.tagName).not.toBe("BUTTON");
    expect(container.querySelector("[data-segment-contents]")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("lists every task of the chart until a segment is picked", () => {
    render(<TileCard {...props()} />);
    expect(listed()).toEqual(["TSK-1", "TSK-2", "TSK-3"]);
  });

  it("narrows the list to a clicked segment, and a click beside the segments widens it back", () => {
    const { container } = render(<TileCard {...props()} />);
    fireEvent.click(container.querySelector('[data-segment="1:value"]')!);
    expect(listed()).toEqual(["TSK-3"]);
    fireEvent.click(container.querySelector("[data-chart-pane]")!);
    expect(listed()).toEqual(["TSK-1", "TSK-2", "TSK-3"]);
  });

  it("drops the pick on a second click on the same segment", () => {
    const { container } = render(<TileCard {...props()} />);
    fireEvent.click(container.querySelector('[data-segment="0:value"]')!);
    fireEvent.click(container.querySelector('[data-segment="0:value"]')!);
    expect(listed()).toEqual(["TSK-1", "TSK-2", "TSK-3"]);
  });

  it("opens a listed task", () => {
    const onOpenTask = vi.fn();
    render(<TileCard {...props({ onOpenTask })} />);
    fireEvent.click(screen.getByRole("button", { name: /TSK-2/ }));
    expect(onOpenTask).toHaveBeenCalledWith("TSK-2");
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

  it("says so when a segment lists only its first tasks", () => {
    const keys = Array.from({ length: CELL_KEYS_MAX }, (_, index) => `TSK-${index + 10}`);
    render(<TileCard {...props({ answer: { ...answer, cells: [[keys], [["TSK-3"]]], values: [[80], [1]] } })} />);
    expect(screen.getByText(`· ${CELL_KEYS_MAX + 1}+`)).toBeTruthy();
    expect(screen.getByText(`Each segment lists its first ${CELL_KEYS_MAX} tasks`)).toBeTruthy();
  });

  it("picks a ring's slice by its arc", () => {
    const { container } = render(<TileCard {...props({ tile: tile(0.6, "ring") })} />);
    fireEvent.click(container.querySelector('[data-arc="done"]')!);
    expect(listed()).toEqual(["TSK-3"]);
  });

  it("picks a bar's segment", () => {
    const { container } = render(<TileCard {...props({ tile: tile(0.6, "bars") })} />);
    fireEvent.click(container.querySelector('[data-segment="0:value"]')!);
    expect(listed()).toEqual(["TSK-1", "TSK-2"]);
  });
});
