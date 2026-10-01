// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { RowField } from "../common/row-field-preference.js";

// Compact viewport: the column menu renders as a drawer whose items are clickable in jsdom.
window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
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
const { TableHeader } = await import("./header.js");
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
  ...patch,
});

const COLUMNS = [
  state("title", { pinned: true, offset: 0, edge: true, width: 360 }),
  state("key"),
  state("status"),
  state("description", { sortable: false }),
];

function renderHeader(columns: HeaderColumnState[] = COLUMNS) {
  const actions: HeaderActions = {
    onSort: vi.fn(),
    onPin: vi.fn(),
    onHide: vi.fn(),
    onMove: vi.fn(),
    onResize: vi.fn(),
  };
  const slot = renderSlot({ component: () => <TableHeader columns={columns} actions={actions} /> }, {}, {});
  return { slot, actions };
}

const header = (slot: ReturnType<typeof renderSlot>, name: string) => slot.getByRole("columnheader", { name: new RegExp(name) });

async function openMenu(slot: ReturnType<typeof renderSlot>, name: string) {
  fireEvent.click(within(header(slot, name)).getByRole("button", { name }));
  // The compact drawer realizes its items a frame after the dialog appears.
  const menu = await slot.findByRole("dialog", { name });
  await within(menu).findAllByRole("menuitem");
  return menu;
}

describe("the column menu", () => {
  it("a click on a header opens its column menu", async () => {
    const { slot } = renderHeader();
    expect(slot.getAllByRole("columnheader").map((cell) => cell.textContent?.trim())).toEqual(["Title", "Key", "Status", "Description"]);
    const menu = await openMenu(slot, "Status");
    const items = within(menu).getAllByRole("menuitem").map((item) => item.textContent?.trim());
    expect(items).toEqual(["Sort ascending", "Sort descending", "Pin column", "Hide column"]);
  });

  it("menu items sort, pin and hide", async () => {
    const { slot, actions } = renderHeader();
    fireEvent.click(within(await openMenu(slot, "Status")).getByRole("menuitem", { name: "Sort descending" }));
    expect(actions.onSort).toHaveBeenCalledWith("status", "desc");
    fireEvent.click(within(await openMenu(slot, "Key")).getByRole("menuitem", { name: "Pin column" }));
    expect(actions.onPin).toHaveBeenCalledWith("key", true);
    fireEvent.click(within(await openMenu(slot, "Title")).getByRole("menuitem", { name: "Unpin column" }));
    expect(actions.onPin).toHaveBeenCalledWith("title", false);
    fireEvent.click(within(await openMenu(slot, "Key")).getByRole("menuitem", { name: "Hide column" }));
    expect(actions.onHide).toHaveBeenCalledWith("key");
  });

  it("a sorted column offers to clear its sort, a resized one to reset its width", async () => {
    const { slot, actions } = renderHeader([state("title"), state("key", { sort: "asc", widthChanged: true })]);
    const menu = await openMenu(slot, "Key");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Clear sort" }));
    expect(actions.onSort).toHaveBeenCalledWith("key", null);
    fireEvent.click(within(await openMenu(slot, "Key")).getByRole("menuitem", { name: "Reset width" }));
    expect(actions.onResize).toHaveBeenCalledWith("key", null);
  });

  it("the title cannot be hidden; an unsortable column offers no sort", async () => {
    const { slot } = renderHeader();
    const titleItems = within(await openMenu(slot, "Title")).getAllByRole("menuitem").map((item) => item.textContent?.trim());
    expect(titleItems).not.toContain("Hide column");
    cleanup();
    const again = renderHeader();
    const descriptionItems = within(await openMenu(again.slot, "Description")).getAllByRole("menuitem").map((item) => item.textContent?.trim());
    expect(descriptionItems).toEqual(["Pin column", "Hide column"]);
  });
});

describe("what a header shows", () => {
  it("a sorted header shows its direction, a pinned one its pin", () => {
    const { slot } = renderHeader([state("title", { pinned: true, offset: 0, edge: true }), state("key", { sort: "desc" }), state("status", { sort: null })]);
    expect(header(slot, "Key").getAttribute("aria-sort")).toBe("descending");
    expect(header(slot, "Status").getAttribute("aria-sort")).toBe("none");
    expect(within(header(slot, "Title")).getByTitle("Pinned")).toBeDefined();
    expect(within(header(slot, "Key")).queryByTitle("Pinned")).toBeNull();
    expect((header(slot, "Title") as HTMLElement).style.left).toBe("0px");
  });
});

describe("pinned headers", () => {
  it("a pinned header sticks at its offset, an unpinned one does not; no header casts a shadow", () => {
    const { slot } = renderHeader([
      state("title", { pinned: true, offset: 0, width: 360 }),
      state("project", { pinned: true, offset: 360, edge: true }),
      state("key"),
    ]);
    const title = header(slot, "Title") as HTMLElement;
    const project = header(slot, "Project") as HTMLElement;
    const key = header(slot, "Key") as HTMLElement;
    expect(title.className).toMatch(/\bsticky\b/);
    expect(project.className).toMatch(/\bsticky\b/);
    expect(project.style.left).toBe("360px");
    expect(key.className).not.toMatch(/\bsticky\b/);
    expect(key.style.left).toBe("");
    for (const cell of slot.getAllByRole("columnheader")) expect(cell.className).not.toMatch(/shadow/);
  });
});

describe("moving and resizing a column", () => {
  const COLS = [state("title"), state("key"), state("status"), state("priority")];

  it("dragging a header past a neighbour moves it", () => {
    const { slot, actions } = renderHeader(COLS);
    const key = within(header(slot, "Key")).getByRole("button", { name: "Key" });
    fireEvent.pointerDown(key, { button: 0, clientX: 150, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 260, clientY: 10 });
    expect(actions.onMove).toHaveBeenCalledWith("key", 2);
    expect(slot.queryByRole("dialog")).toBeNull();

    fireEvent.pointerDown(key, { button: 0, clientX: 150, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 360, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 360, clientY: 10 });
    expect(actions.onMove).toHaveBeenLastCalledWith("key", 3);
  });

  it("a press without a drag moves nothing", () => {
    const { slot, actions } = renderHeader(COLS);
    const key = within(header(slot, "Key")).getByRole("button", { name: "Key" });
    fireEvent.pointerDown(key, { button: 0, clientX: 150, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 152, clientY: 11 });
    fireEvent.pointerUp(window, { clientX: 152, clientY: 11 });
    expect(actions.onMove).not.toHaveBeenCalled();
  });

  it("dragging the edge resizes; a double click resets", () => {
    const { slot, actions } = renderHeader([state("title", { width: 360 }), state("key")]);
    const edge = slot.getByRole("separator", { name: "Resize Title" });
    fireEvent.pointerDown(edge, { button: 0, clientX: 360, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 420, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 420, clientY: 10 });
    expect(actions.onResize).toHaveBeenLastCalledWith("title", 420);
    expect(actions.onMove).not.toHaveBeenCalled();
    fireEvent.doubleClick(edge);
    expect(actions.onResize).toHaveBeenLastCalledWith("title", null);
  });
});
