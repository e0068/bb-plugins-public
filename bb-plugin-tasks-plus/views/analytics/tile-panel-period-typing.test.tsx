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

await loadPluginApp(() => import("../../app"));
const { newTile } = await import("./default-dashboard");
const { TilePanel } = await import("./tile-panel");

afterEach(cleanup);

describe("TilePanel — typing the period's length", () => {
  it("lets the field be cleared and a new number typed in its place", () => {
    const onChange = vi.fn<(next: Tile) => void>();
    render(<TilePanel draft={newTile("t", { window: { unit: "hour", count: 24 } })} isNew={false} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} />);
    const length = screen.getByLabelText("Period length") as HTMLInputElement;
    fireEvent.change(length, { target: { value: "" } });
    expect(length.value).toBe("");
    fireEvent.change(length, { target: { value: "6" } });
    expect(onChange.mock.calls.at(-1)![0].window).toEqual({ unit: "hour", count: 6 });
  });
});
