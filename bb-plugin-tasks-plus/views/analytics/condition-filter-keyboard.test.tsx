// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

import type { SuggestionScope, TileCondition } from "../../shared/tile-conditions.js";

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
const { ConditionFilter } = await import("./condition-filter");

afterEach(cleanup);

const scope: SuggestionScope = { tasks: [], projects: [], labels: [{ name: "ui" }, { name: "backend" }] };

describe("ConditionFilter — the value list from the keyboard", () => {
  it("moves down the list with the arrow and picks with Enter", () => {
    const onChange = vi.fn<(next: TileCondition[]) => void>();
    function Harness() {
      const [conditions, setConditions] = useState<readonly TileCondition[]>([{ field: "labels", op: "eq", value: "" }]);
      return <ConditionFilter conditions={conditions} scope={scope} onChange={(next) => (onChange(next), setConditions(next))} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^Labels/ }));
    const value = within(screen.getByRole("dialog", { name: "Labels filter" })).getByLabelText("Value");
    fireEvent.focus(value);
    fireEvent.keyDown(value, { key: "ArrowDown" });
    fireEvent.keyDown(value, { key: "Enter" });
    expect(onChange.mock.calls.at(-1)![0]).toEqual([{ field: "labels", op: "eq", value: "ui" }]);
  });
});
