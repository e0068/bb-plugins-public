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

describe("TileCard — a switch with no room", () => {
  it("turns into the picked value with a chevron that opens every value", () => {
    rowWidth = SEGMENT_PX + 20; // one segment and no room for +N beside it
    render(<TileCard {...props()} />);
    observed.forEach((callback) => callback([], {} as ResizeObserver));
    expect(screen.queryByRole("button", { name: /^\+\d/ })).toBeNull();
    const trigger = screen.getByRole("button", { name: "All, pick another" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });
});
