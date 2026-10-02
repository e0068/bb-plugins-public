// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tile, TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { TileCard, type TileCardProps } from "./tile-card";

window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

/** jsdom lays nothing out: every segment is this wide, and the switch row as wide as a test says. */
const SEGMENT_PX = 60;
let rowWidth = 1000;
let observed: ResizeObserverCallback[] = [];
window.ResizeObserver = class {
  constructor(callback: ResizeObserverCallback) {
    observed.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return this.dataset.switchRow !== undefined ? rowWidth : this.dataset.segmentKey !== undefined ? SEGMENT_PX : 0;
  },
});

afterEach(() => {
  cleanup();
  observed = [];
  rowWidth = 1000;
});

const PROJECTS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

const answer = (patch: Partial<TileAnswer> = {}): TileAnswer => ({
  columns: [{ key: "todo", label: "todo" }],
  series: [
    { key: "value", label: "Tasks" },
  ],
  values: [[3]],
  cells: [[["TSK-1"]]],
  titles: { "TSK-1": "One" },
  switchValues: PROJECTS.map((name, index) => ({ key: `P${index}`, label: name, count: index + 1 })),
  total: 3,
  rows: [],
  figures: {},
  projects: PROJECTS.map((name, index) => ({ id: `P${index}`, name })),
  logStartMs: null,
  ...patch,
});

const props = (patch: Partial<TileCardProps> = {}): TileCardProps => ({
  tile: newTile("t", { title: "Burndown", x: "status", breakdown: null, switch: "project" }),
  answer: answer(),
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
  ...patch,
});

const openMenu = () => fireEvent.keyDown(screen.getByRole("button", { name: "Chart actions" }), { key: "Enter" });

describe("TileCard", () => {
  it("is filled like a task card, with no border", () => {
    render(<TileCard {...props()} />);
    const card = screen.getByRole("region", { name: "Burndown" });
    expect(card.className).toContain("bg-surface-recessed-solid");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).not.toMatch(/\bborder\b/);
  });

  it("offers Edit chart, Duplicate and Delete under its three dots", () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    render(<TileCard {...props({ onEdit, onDuplicate, onDelete })} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit chart" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect([onEdit, onDuplicate, onDelete].map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("switches by a segmented control, All first", () => {
    const onPick = vi.fn();
    render(<TileCard {...props({ onPick })} />);
    const group = screen.getByRole("group", { name: "Switch Burndown" });
    expect(group.querySelectorAll("[data-segment-key]")[0]!.textContent).toBe("All");
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onPick).toHaveBeenCalledWith("P1");
  });

  it("folds the values that do not fit into a +N segment", () => {
    rowWidth = 3 * SEGMENT_PX + 40; // three segments and the +N one
    render(<TileCard {...props()} />);
    observed.forEach((callback) => callback([], {} as ResizeObserver));
    expect(screen.getByRole("button", { name: "+3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delta" })).toBeNull();
  });

  it("puts the legend where the tile says, or nowhere", () => {
    const two = answer({ series: [{ key: "todo", label: "todo" }, { key: "done", label: "done" }], values: [[1, 2]], cells: [[[], []]] });
    const tile = (legend: Tile["display"]["legend"]) => newTile("t", { title: "T", x: "status", display: { legend, xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false } });
    const { container, rerender } = render(<TileCard {...props({ tile: tile("right"), answer: two })} />);
    expect(container.querySelector('[data-legend="right"]')).not.toBeNull();
    rerender(<TileCard {...props({ tile: tile("bottom"), answer: two })} />);
    expect(container.querySelector('[data-legend="bottom"]')).not.toBeNull();
    rerender(<TileCard {...props({ tile: tile("hidden"), answer: two })} />);
    expect(container.querySelector("[data-legend]")).toBeNull();
  });
});
