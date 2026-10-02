// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  return () => onChange.mock.calls.at(-1)![0];
}

const pickType = (name: string) => fireEvent.click(within(screen.getByRole("group", { name: "Chart type" })).getByRole("button", { name }));

describe("TilePanel — bars print their values", () => {
  it("turns the values on when a chart becomes bars", () => {
    const last = panel(newTile("t"));
    pickType("Bars");
    expect(last().display.yLabels).toBe(true);
  });

  it("keeps the bars' own choice while they stay bars", () => {
    const last = panel(newTile("t", { type: "bars" }));
    pickType("Bars");
    expect(last().display.yLabels).toBe(false);
  });
});
