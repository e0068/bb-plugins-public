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
    onPin: vi.fn(),
    onHide: vi.fn(),
    onMove: vi.fn(),
    onResize: vi.fn(),
    onDisplay: vi.fn(),
  };
  const slot = renderSlot({ component: () => <TableHeader columns={columns} actions={actions} /> }, {}, {});
  return { slot, actions };
}

async function openMenu(slot: ReturnType<typeof renderSlot>, name: string) {
  const header = slot.getByRole("columnheader", { name: new RegExp(name) });
  fireEvent.click(within(header).getByRole("button", { name }));
  const menu = await slot.findByRole("dialog", { name });
  await within(menu).findAllByRole("menuitem");
  return menu;
}

describe("a column's format and icon in its menu", () => {
  it("a date column offers its formats, the current one checked", async () => {
    const { slot } = renderHeader([state("title"), state("createdAt", { dateFormat: "dateTime", icon: false })]);
    const menu = await openMenu(slot, "Created");
    const formats = within(menu).getAllByRole("menuitemcheckbox").filter((item) => item.textContent?.trim() !== "Show icon");
    expect(formats.map((item) => item.textContent?.trim())).toEqual(["Date and time", "Date", "Relative"]);
    expect(formats.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("choosing a format or the icon reports it for the column", async () => {
    const { slot, actions } = renderHeader([state("title"), state("updatedAt", { dateFormat: "dateTime", icon: false })]);
    fireEvent.click(within(await openMenu(slot, "Edited")).getByRole("menuitemcheckbox", { name: "Relative" }));
    expect(actions.onDisplay).toHaveBeenCalledWith("updatedAt", { format: "relative" });
    fireEvent.click(within(await openMenu(slot, "Edited")).getByRole("menuitemcheckbox", { name: "Show icon" }));
    expect(actions.onDisplay).toHaveBeenCalledWith("updatedAt", { icon: true });
  });

  it("a column without dates or a switchable icon offers neither", async () => {
    const { slot } = renderHeader([state("title"), state("key")]);
    const menu = await openMenu(slot, "Key");
    expect(within(menu).queryAllByRole("menuitemcheckbox")).toEqual([]);
  });
});
