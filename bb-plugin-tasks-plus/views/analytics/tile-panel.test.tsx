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

// The filter chips reach the SDK: nothing SDK-touching may load before the fake runtime.
await loadPluginApp(() => import("../../app"));
const { newTile } = await import("./default-dashboard");
const { TilePanel } = await import("./tile-panel");

afterEach(cleanup);

function panel(draft: Tile) {
  const onChange = vi.fn<(next: Tile) => void>();
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<TilePanel draft={draft} isNew={false} onChange={onChange} onSave={onSave} onCancel={onCancel} />);
  return { onChange, onSave, onCancel, last: () => onChange.mock.calls.at(-1)![0] };
}

const pick = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

describe("TilePanel", () => {
  it("shows only the settings the chart type reads", () => {
    const { last } = panel(newTile("t"));
    expect(screen.getByLabelText("X axis")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Task list" }));
    expect(last().type).toBe("list");
    cleanup();
    panel(newTile("t", { type: "list" }));
    expect(screen.queryByLabelText("X axis")).toBeNull();
    expect(screen.getByLabelText("Rows shown")).toBeTruthy();
  });

  it("asks which number to add up when Y sums a field", () => {
    const { last } = panel(newTile("t"));
    pick("Y axis", "Sum of…");
    expect(last().y).toEqual({ metric: "sum", field: "cost" });
    cleanup();
    panel(newTile("t", { y: { metric: "sum", field: "cost" } }));
    expect(screen.getByLabelText("Summed field")).toBeTruthy();
  });

  it("offers every field of the board's filter on the X axis, time first", () => {
    panel(newTile("t"));
    fireEvent.click(screen.getByLabelText("X axis"));
    const names = screen.getAllByRole("option").map((option) => option.textContent);
    expect(names[0]).toBe("Time");
    expect(names).toEqual(expect.arrayContaining(["Status", "Project", "Labels", "Cost", "Due date", "Title"]));
  });

  it("hides the legend, sets the grid and the axis labels", () => {
    const { last } = panel(newTile("t"));
    fireEvent.click(screen.getByRole("button", { name: "Hidden" }));
    expect(last().display.legend).toBe("hidden");
    fireEvent.change(screen.getByLabelText("Grid lines up, every"), { target: { value: "5" } });
    expect(last().display.grid.y).toBe(5);
    fireEvent.click(screen.getByRole("checkbox", { name: "Y axis labels" }));
    expect(last().display.yLabels).toBe(true);
  });

  it("renames the tile, sorts it and hands Save and Cancel back", () => {
    const { last, onSave, onCancel } = panel(newTile("t", { x: "project" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Mine" } });
    expect(last().title).toBe("Mine");
    pick("Sort", "Y value");
    expect(last().sort).toEqual({ by: "value", direction: "desc" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect([onSave.mock.calls.length, onCancel.mock.calls.length]).toEqual([1, 1]);
  });

  it("filters by conditions: a row added in the filter lands in the draft", async () => {
    const { last } = panel(newTile("t"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cost" }));
    expect(last().conditions).toEqual([{ field: "cost", op: "eq", value: "" }]);
  });
});
