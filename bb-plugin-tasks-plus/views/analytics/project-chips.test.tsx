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

describe("ProjectChips", () => {
  it("shows every project when they all fit", () => {
    render(<ProjectChips projects={PROJECTS} picked={[]} onAll={vi.fn()} onToggle={vi.fn()} />);
    expect(PROJECTS.every((project) => screen.queryByRole("button", { name: project.name }) !== null)).toBe(true);
    expect(screen.queryByRole("button", { name: /^\+/ })).toBeNull();
  });

  it("keeps to one row: the projects that do not fit go under +N", () => {
    rowWidth = 3 * CHIP_PX + 40; // All projects, two chips and the +N one
    render(<ProjectChips projects={PROJECTS} picked={[]} onAll={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gamma" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "+3" }), { key: "Enter" });
    expect(screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent)).toEqual(["Gamma", "Delta", "Epsilon"]);
  });

  it("toggles a folded project from the +N menu", () => {
    rowWidth = 3 * CHIP_PX + 40;
    const onToggle = vi.fn();
    render(<ProjectChips projects={PROJECTS} picked={["P3"]} onAll={vi.fn()} onToggle={onToggle} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "+3" }), { key: "Enter" });
    expect(screen.getByRole("menuitemcheckbox", { name: "Delta" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Epsilon" }));
    expect(onToggle).toHaveBeenCalledWith("P4");
  });
});
