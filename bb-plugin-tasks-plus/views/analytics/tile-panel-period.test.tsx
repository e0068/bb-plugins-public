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

describe("TilePanel — Period", () => {
  it("offers the header's period, minutes, hours and days", () => {
    panel(newTile("t"));
    fireEvent.click(screen.getByLabelText("Period"));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["As in header", "Minutes", "Hours", "Days"]);
  });

  it("asks for the exact number once a unit is picked", () => {
    const { last } = panel(newTile("t"));
    expect(screen.queryByLabelText("Period length")).toBeNull();
    fireEvent.click(screen.getByLabelText("Period"));
    fireEvent.click(screen.getByRole("option", { name: "Hours" }));
    expect(last().window).toEqual({ unit: "hour", count: 24 });
    cleanup();
    const next = panel(newTile("t", { window: { unit: "hour", count: 24 } }));
    fireEvent.change(screen.getByLabelText("Period length"), { target: { value: "6" } });
    expect(next.last().window).toEqual({ unit: "hour", count: 6 });
  });
});
