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
  dateFormat: null,
  icon: null,
  ...patch,
});

function renderHeader(columns: HeaderColumnState[]) {
  const actions: HeaderActions = {
    onSort: vi.fn(),
    onResize: vi.fn(),
    onDisplay: vi.fn(),
    onHeaderIcon: vi.fn(),
  };
  const slot = renderSlot({ component: () => <TableHeader columns={columns} actions={actions} /> }, {}, {});
  return { slot, actions };
}

const header = (slot: ReturnType<typeof renderSlot>, name: string) => slot.getByRole("columnheader", { name: new RegExp(name) });

async function openMenu(slot: ReturnType<typeof renderSlot>, name: string) {
  fireEvent.click(within(header(slot, name)).getByRole("button", { name }));
  const menu = await slot.findByRole("dialog", { name });
  await within(menu).findAllByRole("menuitem");
  return menu;
}

describe("a column's icon", () => {
  it("stands before the column's name", () => {
    const { slot } = renderHeader([state("status", { headerIcon: "🚦" })]);
    expect(header(slot, "Status").querySelector("text")?.textContent).toBe("🚦");
  });

  it("is picked from the column's menu", async () => {
    const { slot, actions } = renderHeader([state("status")]);
    fireEvent.click(within(await openMenu(slot, "Status")).getByRole("menuitem", { name: "Set icon…" }));
    fireEvent.click(await slot.findByRole("button", { name: "Emoji" }));
    fireEvent.change(await slot.findByLabelText("Search icons"), { target: { value: "traffic" } });
    fireEvent.click(await slot.findByRole("button", { name: "🚦" }));

    expect(actions.onHeaderIcon).toHaveBeenCalledWith("status", "🚦");
  });

  it("is taken off from the picker", async () => {
    const { slot, actions } = renderHeader([state("status", { headerIcon: "🚦" })]);
    fireEvent.click(within(await openMenu(slot, "Status")).getByRole("menuitem", { name: "Set icon…" }));
    fireEvent.click(await slot.findByRole("button", { name: "Remove icon" }));

    expect(actions.onHeaderIcon).toHaveBeenCalledWith("status", null);
  });
});
