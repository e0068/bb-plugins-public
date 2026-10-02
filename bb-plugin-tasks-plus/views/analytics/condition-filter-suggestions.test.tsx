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

const scope: SuggestionScope = { tasks: [], projects: [{ id: "P", name: "bb-plugins" }], labels: [{ name: "ui" }, { name: "backend" }] };

function filter(initial: readonly TileCondition[]) {
  const onChange = vi.fn<(next: TileCondition[]) => void>();
  function Harness() {
    const [conditions, setConditions] = useState<readonly TileCondition[]>(initial);
    return <ConditionFilter conditions={conditions} scope={scope} onChange={(next) => (onChange(next), setConditions(next))} />;
  }
  render(<Harness />);
  return { last: () => onChange.mock.calls.at(-1)![0] };
}

describe("ConditionFilter — values already on the boards", () => {
  it("drops a list of the field's values under the value field, narrowed by what is typed, and picks one on a click", () => {
    const { last } = filter([{ field: "labels", op: "eq", value: "" }]);
    fireEvent.click(screen.getByRole("button", { name: /^Labels/ }));
    const menu = screen.getByRole("dialog", { name: "Labels filter" });
    const value = within(menu).getByLabelText("Value");
    fireEvent.focus(value);
    expect(within(menu).getAllByRole("option").map((option) => option.textContent)).toEqual(["backend", "ui"]);
    fireEvent.change(value, { target: { value: "ba" } });
    expect(within(menu).getAllByRole("option").map((option) => option.textContent)).toEqual(["backend"]);
    fireEvent.click(within(menu).getByRole("option", { name: "backend" }));
    expect(last()).toEqual([{ field: "labels", op: "eq", value: "backend" }]);
  });

  it("picks Type from its list, as Status", () => {
    filter([{ field: "type", op: "eq", value: "" }]);
    fireEvent.click(screen.getByRole("button", { name: /^Type/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Type filter" })).getByLabelText("Value"));
    expect(screen.getByRole("option", { name: "Feature" })).toBeTruthy();
  });
});
