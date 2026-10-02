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
  return { last: () => onChange.mock.calls.at(-1)![0] };
}

const listed = () => {
  const base = newTile("t");
  return { ...base, display: { ...base.display, contents: 0.6 } };
};

describe("TilePanel — the table under the chart", () => {
  it("opens the table's settings under Show segment contents, and none while it is off", () => {
    panel(newTile("t"));
    expect(document.querySelector("[data-table-settings]")).toBeNull();
    cleanup();
    panel(listed());
    expect(screen.getByRole("group", { name: "Table columns" })).toBeTruthy();
    expect(screen.getByText(/Filter — shared with the chart/)).toBeTruthy();
  });

  it("shows and hides a column, the title always staying", () => {
    const { last } = panel(listed());
    fireEvent.click(screen.getByRole("button", { name: "Cost", pressed: false }));
    expect(last().table!.columns).toEqual(["key", "title", "status", "project", "cost"]);
    cleanup();
    const again = panel(listed());
    fireEvent.click(screen.getByRole("button", { name: "Status", pressed: true }));
    expect(again.last().table!.columns).toEqual(["key", "title", "project"]);
    expect(screen.queryByRole("button", { name: "Title", pressed: true })).toBeNull();
  });

  it("moves a column by its grip", () => {
    const { last } = panel(listed());
    const rows = Array.from(screen.getByRole("group", { name: "Table columns" }).children) as HTMLElement[];
    rows.forEach((row, index) => (row.getBoundingClientRect = () => ({ top: index * 20, height: 20 }) as DOMRect));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Reorder Project" }));
    fireEvent.pointerMove(window, { clientY: 5 });
    fireEvent.pointerUp(window);
    expect(last().table!.columns).toEqual(["project", "key", "title", "status"]);
  });

  it("sets the rows a segment shows and the row height", () => {
    const { last } = panel(listed());
    fireEvent.change(screen.getByLabelText("Rows per segment"), { target: { value: "25" } });
    expect(last().table!.rows).toBe(25);
    fireEvent.click(within(screen.getByRole("group", { name: "Row height" })).getByRole("button", { name: "Compact" }));
    expect(last().table!.rowHeight).toBe("compact");
  });

  it("names the filter the chart's and the table's while the table is on", () => {
    panel(listed());
    expect(screen.getByText("— chart and table")).toBeTruthy();
  });
});
