// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

const scope: SuggestionScope = { tasks: [], projects: [], labels: [{ name: "api" }, { name: "backend" }, { name: "ui" }] };

function openValue() {
  function Harness() {
    const [conditions, setConditions] = useState<readonly TileCondition[]>([{ field: "labels", op: "eq", value: "" }]);
    return <ConditionFilter conditions={conditions} scope={scope} onChange={setConditions} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: /^Labels/ }));
  const value = within(screen.getByRole("dialog", { name: "Labels filter" })).getByLabelText("Value");
  fireEvent.focus(value);
  return value;
}

const highlighted = () => document.querySelector('[cmdk-item][aria-selected="true"]')?.textContent;

describe("ConditionFilter — the value field keeps its own keys", () => {
  it("leaves Home and End to the text: the browser moves the cursor, the list keeps its highlight", () => {
    const value = openValue();
    fireEvent.keyDown(value, { key: "ArrowDown" });
    const before = highlighted();
    expect(fireEvent.keyDown(value, { key: "Home" })).toBe(true);
    expect(fireEvent.keyDown(value, { key: "End" })).toBe(true);
    expect(highlighted()).toBe(before);
  });

  it("leaves Ctrl+N, Ctrl+P, Ctrl+J and Ctrl+K to the text, as a macOS field reads them", () => {
    const value = openValue();
    const before = highlighted();
    ["n", "j", "p", "k"].forEach((key) => fireEvent.keyDown(value, { key, ctrlKey: true }));
    expect(highlighted()).toBe(before);
  });
});
