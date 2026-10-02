// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

/** jsdom lays nothing out: every chip is this wide, and the chips' row as wide as a test says. */
const CHIP_PX = 100;
let rowWidth = 2000;
window.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return this.dataset.chipsRow !== undefined ? rowWidth : this.dataset.chip !== undefined ? CHIP_PX : 0;
  },
});

await loadPluginApp(() => import("../../app"));
const { ProjectChips } = await import("./AnalyticsDashboard");

afterEach(() => {
  cleanup();
  rowWidth = 2000;
});


const PROJECTS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map((name, index) => ({ id: `P${index}`, name }));

describe("ProjectChips — the ruler", () => {
  it("measures every chip inside a box clipped to the row, so a long row of projects does not widen the page", () => {
    render(<ProjectChips projects={PROJECTS} picked={[]} onAll={vi.fn()} onToggle={vi.fn()} />);
    const row = document.querySelector("[data-chips-row]")!;
    const ruler = document.querySelector("[data-chip]")!.parentElement!;
    const clip = ruler.parentElement!;
    expect(clip.parentElement).toBe(row);
    expect(clip.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "overflow-hidden", "inset-x-0"]));
    expect(ruler.querySelectorAll("[data-chip]")).toHaveLength(PROJECTS.length + 1);
  });
});
