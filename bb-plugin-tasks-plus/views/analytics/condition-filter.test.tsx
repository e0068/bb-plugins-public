// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

import type { TileCondition } from "../../shared/tile-conditions.js";

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

// The overlays read the host's viewport through the SDK: nothing may load before the fake runtime.
await loadPluginApp(() => import("../../app"));
const { ConditionFilter } = await import("./condition-filter");

afterEach(cleanup);

function filter(initial: readonly TileCondition[] = []) {
  const onChange = vi.fn<(next: TileCondition[]) => void>();
  function Harness() {
    const [conditions, setConditions] = useState<readonly TileCondition[]>(initial);
    return (
      <ConditionFilter
        conditions={conditions}
        onChange={(next) => {
          onChange(next);
          setConditions(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { onChange, last: () => onChange.mock.calls.at(-1)![0] };
}

const pickField = async (name: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: "Filter" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name }));
};

const menuOf = (field: string) => screen.getByRole("dialog", { name: `${field} filter` });

describe("ConditionFilter", () => {
  it("shows the picked field's chip with a menu under it: a row with =, ≠, >, < and a value, and a way to add a row", async () => {
    filter();
    await pickField("Cost");
    expect(document.querySelector('[data-condition-chip="cost"]')).not.toBeNull();
    const menu = menuOf("Cost");
    const row = within(menu).getByRole("group", { name: "Condition 1" });
    expect(within(row).getByLabelText("Value")).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Add condition" })).toBeTruthy();
    fireEvent.click(within(row).getByLabelText("Operator"));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["=", "≠", ">", "<"]);
  });

  it("writes the row's operator and value into the filter", async () => {
    const { last } = filter();
    await pickField("Cost");
    const row = within(menuOf("Cost")).getByRole("group", { name: "Condition 1" });
    fireEvent.click(within(row).getByLabelText("Operator"));
    fireEvent.click(screen.getByRole("option", { name: ">" }));
    fireEvent.change(within(row).getByLabelText("Value"), { target: { value: "5" } });
    expect(last()).toEqual([{ field: "cost", op: "gt", value: "5" }]);
    expect(document.querySelector('[data-condition-chip="cost"]')?.textContent).toContain("> 5");
  });

  it("adds a second row to the same field", async () => {
    const { last } = filter([{ field: "status", op: "eq", value: "todo" }]);
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    fireEvent.click(within(menuOf("Status")).getByRole("button", { name: "Add condition" }));
    expect(within(menuOf("Status")).getAllByRole("group", { name: /^Condition / })).toHaveLength(2);
    expect(last()).toEqual([
      { field: "status", op: "eq", value: "todo" },
      { field: "status", op: "eq", value: "" },
    ]);
  });

  it("offers the values of a field with a known list to pick", async () => {
    filter();
    await pickField("Status");
    const row = within(menuOf("Status")).getByRole("group", { name: "Condition 1" });
    fireEvent.click(within(row).getByLabelText("Value"));
    expect(screen.getByRole("option", { name: "In Progress" })).toBeTruthy();
  });

  it("drops a row by its cross and the whole field by the chip's cross", () => {
    const { last } = filter([
      { field: "status", op: "eq", value: "todo" },
      { field: "status", op: "eq", value: "done" },
      { field: "cost", op: "gt", value: "5" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    fireEvent.click(within(menuOf("Status")).getByRole("button", { name: "Remove condition 2" }));
    expect(last()).toEqual([
      { field: "status", op: "eq", value: "todo" },
      { field: "cost", op: "gt", value: "5" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Cost filter" }));
    expect(last()).toEqual([{ field: "status", op: "eq", value: "todo" }]);
  });
});
