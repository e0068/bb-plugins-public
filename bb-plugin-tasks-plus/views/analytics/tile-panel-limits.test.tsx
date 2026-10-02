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

describe("TilePanel — what it lets through", () => {
  it("holds the title to the schema's limit", () => {
    panel(newTile("t"));
    expect((screen.getByLabelText("Title") as HTMLInputElement).maxLength).toBe(120);
  });

  it("keeps the grid across at one column or more", () => {
    const { last } = panel(newTile("t"));
    fireEvent.change(screen.getByLabelText("Grid lines across, every"), { target: { value: "0.3" } });
    expect(last().display.grid.x).toBe(1);
  });

  it("says what each figure counts", () => {
    panel(newTile("t", { type: "big", figures: [] }));
    expect(screen.getByRole("checkbox", { name: "Open tasks" })).toBeTruthy();
    expect(screen.getByText("Backlog, to do, in progress and in review now")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Closed in the period" })).toBeTruthy();
  });

  it("ticks a figure in the strip's order", () => {
    const { last } = panel(newTile("t", { type: "big", figures: ["done"] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Open tasks" }));
    expect(last().figures).toEqual(["open", "done"]);
  });
});
