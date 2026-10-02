// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

import type { Tile } from "../../shared/contract.js";

window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

await loadPluginApp(() => import("../../app"));
const { newTile } = await import("./default-dashboard");
const { TilePanel } = await import("./tile-panel");

afterEach(cleanup);

function panel(draft: Tile) {
  const onChange = vi.fn<(next: Tile) => void>();
  render(<TilePanel draft={draft} isNew={false} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} />);
  return { last: () => onChange.mock.calls.at(-1)![0] };
}

const AXES = ["X axis labels", "Y axis labels", "Grid lines across, every", "Grid lines up, every"];

describe("TilePanel — segment contents", () => {
  it("turns segment contents on at the starting share, and off by dropping it", () => {
    const off = panel(newTile("t"));
    fireEvent.click(screen.getByLabelText("Show segment contents"));
    expect(off.last().display.contents).toBe(0.6);
    cleanup();
    const base = newTile("t");
    const on = panel({ ...base, display: { ...base.display, contents: 0.4 } });
    fireEvent.click(screen.getByLabelText("Show segment contents"));
    expect("contents" in on.last().display).toBe(false);
  });

  it("gives a ring its legend and segment contents, and no axis labels or grid", () => {
    panel(newTile("t", { type: "ring", x: "project", breakdown: null }));
    expect(screen.getByLabelText("Show segment contents")).toBeTruthy();
    expect(AXES.filter((label) => screen.queryByLabelText(label) !== null)).toEqual([]);
  });

  it("gives a Gantt no axis labels, no grid and no segment contents", () => {
    panel(newTile("t", { type: "bars", bars: { length: "range", gantt: "fact" } }));
    expect([...AXES, "Show segment contents"].filter((label) => screen.queryByLabelText(label) !== null)).toEqual([]);
  });

  it("offers no segment contents to a line", () => {
    panel(newTile("t", { type: "line" }));
    expect(screen.queryByLabelText("Show segment contents")).toBeNull();
  });
});
