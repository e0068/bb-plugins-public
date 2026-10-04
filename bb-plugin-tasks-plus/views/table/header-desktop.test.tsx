// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RowField } from "../common/row-field-preference.js";

// Desktop viewport: the column menu is Radix's own dropdown, which opens on a
// press unless the header holds it back — the case the owner hit.
window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

/** jsdom lays nothing out: header i spans x from 100·i to 100·i + 100. */
Element.prototype.getBoundingClientRect = function (this: Element) {
  const rect = (left: number, width: number) =>
    ({ left, top: 0, width, height: 32, right: left + width, bottom: 32, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  if (this.getAttribute("role") === "columnheader") {
    const headers = Array.from(document.querySelectorAll('[role="columnheader"]'));
    return rect(headers.indexOf(this) * 100, 100);
  }
  return rect(0, 5000);
};

await loadPluginApp(() => import("../../app"));
const { TableHeader, HEADER_HEIGHT_PX } = await import("./header.js");
type HeaderColumnState = import("./header.js").HeaderColumnState;
type HeaderActions = import("./header.js").HeaderActions;

afterEach(cleanup);

const state = (column: RowField, patch: Partial<HeaderColumnState> = {}): HeaderColumnState => ({
  column,
  width: 100,
  pinned: false,
  offset: undefined,
  edge: false,
  sort: null,
  sortable: true,
  widthChanged: false,
  dateFormat: null,
  icon: null,
  ...patch,
});

const COLS = [state("title"), state("key"), state("status"), state("priority")];

function renderHeader(columns: HeaderColumnState[] = COLS) {
  const actions: HeaderActions = {
    onSort: vi.fn(),
    onPin: vi.fn(),
    onHide: vi.fn(),
    onMove: vi.fn(),
    onResize: vi.fn(),
    onDisplay: vi.fn(),
  };
  const slot = renderSlot({ component: () => <TableHeader columns={columns} actions={actions} /> }, {}, {});
  return { slot, actions };
}

const header = (slot: ReturnType<typeof renderSlot>, name: string) =>
  slot.getByRole("columnheader", { name: new RegExp(name) });
const headerButton = (slot: ReturnType<typeof renderSlot>, name: string) =>
  within(header(slot, name)).getByRole("button", { name });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a press on a header on desktop", () => {
  it("does not open the column menu by itself; the click that completes it does", async () => {
    const { slot } = renderHeader();
    const key = headerButton(slot, "Key");
    fireEvent.pointerDown(key, { button: 0, clientX: 150, clientY: 10 });
    await tick();
    expect(slot.queryByRole("menu")).toBeNull();
    fireEvent.pointerUp(window, { clientX: 150, clientY: 10 });
    fireEvent.click(key);
    expect(await slot.findByRole("menu")).toBeDefined();
  });

  it("a drag moves the column and leaves the menu closed, even when the click lands on the header", async () => {
    const { slot, actions } = renderHeader();
    const key = headerButton(slot, "Key");
    fireEvent.pointerDown(key, { button: 0, clientX: 150, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 260, clientY: 10 });
    fireEvent.click(key);
    await tick();
    expect(actions.onMove).toHaveBeenCalledWith("key", 2);
    expect(slot.queryByRole("menu")).toBeNull();
  });
});

describe("while a column is dragged", () => {
  it("a line marks the side it lands on and the dragged header dims; both clear on release", () => {
    const { slot } = renderHeader();
    const key = headerButton(slot, "Key");
    fireEvent.pointerDown(key, { button: 0, clientX: 150, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 10 });
    expect(header(slot, "Status").querySelector('[data-drop-line="after"]')).not.toBeNull();
    expect(header(slot, "Key").hasAttribute("data-dragging")).toBe(true);

    fireEvent.pointerMove(window, { clientX: 40, clientY: 10 });
    expect(header(slot, "Status").querySelector("[data-drop-line]")).toBeNull();
    expect(header(slot, "Title").querySelector('[data-drop-line="before"]')).not.toBeNull();

    fireEvent.pointerUp(window, { clientX: 40, clientY: 10 });
    expect(slot.container.querySelector("[data-drop-line]")).toBeNull();
    expect(header(slot, "Key").hasAttribute("data-dragging")).toBe(false);
  });

  it("no line while the pointer stays over the dragged header itself", () => {
    const { slot } = renderHeader();
    const key = headerButton(slot, "Key");
    fireEvent.pointerDown(key, { button: 0, clientX: 150, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 10 });
    expect(slot.container.querySelector("[data-drop-line]")).toBeNull();
    fireEvent.pointerUp(window, { clientX: 160, clientY: 10 });
  });
});

describe("resizing a column", () => {
  it("the page shows the resize cursor and selects no text until the edge is released", () => {
    const { slot, actions } = renderHeader();
    const edge = slot.getByRole("separator", { name: "Resize Key" });
    fireEvent.pointerDown(edge, { button: 0, clientX: 200, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 10 });
    expect(actions.onResize).toHaveBeenLastCalledWith("key", 140);
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.pointerUp(window, { clientX: 240, clientY: 10 });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });
});

describe("the header row", () => {
  it("is exactly as tall as the offset the group headers stick at", () => {
    const { slot } = renderHeader();
    expect((slot.getByRole("row") as HTMLElement).style.height).toBe(`${HEADER_HEIGHT_PX}px`);
  });

});
