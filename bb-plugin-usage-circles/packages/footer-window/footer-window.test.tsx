// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOVER_LEAVE_MS,
  registerFooterWindow,
  resetFooterWindowsForTests,
  setOpenOnHover,
  withFooterWindow,
  type DisclosureController,
} from "./footer-window";

/** BB's sidebar footer: two items of plugin `p`, one of plugin `q`, and the open window of `p/a`. */
function mountFooter(): void {
  document.body.innerHTML = `
    <div data-sidebar="content"></div>
    <div data-sidebar="footer">
      <section id="plugin-sidebar-footer-disclosure-p-a-1" data-testid="plugin-sidebar-footer-disclosure-p-a"
        class="rounded-lg border"><div class="max-h-80 overflow-auto"><div id="mount"></div></div></section>
      <ul data-sidebar="menu">
        <li data-footer-item="plugin:p/a"><button aria-label="A">a</button></li>
        <li data-footer-item="plugin:p/b"><button aria-label="B">b</button></li>
        <li data-footer-item="plugin:q/c"><button aria-label="C">c</button></li>
      </ul>
    </div>
    <main id="away"></main>`;
}

const fakeController = (): DisclosureController & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, open: () => calls.push("open"), close: () => calls.push("close"), toggle: () => calls.push("toggle") };
};

const button = (label: string) => document.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
const away = () => document.getElementById("away")!;
const section = () => document.querySelector<HTMLElement>("section")!;
const frame = () => section().firstElementChild as HTMLElement;

let a: ReturnType<typeof fakeController>;
let b: ReturnType<typeof fakeController>;
let c: ReturnType<typeof fakeController>;

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  window.localStorage.clear();
  mountFooter();
  a = fakeController();
  b = fakeController();
  c = fakeController();
  registerFooterWindow({ pluginId: "p", itemId: "a", label: "A" }, a);
  registerFooterWindow({ pluginId: "p", itemId: "b", label: "B" }, b);
  registerFooterWindow({ pluginId: "q", itemId: "c", label: "C" }, c);
  setOpenOnHover("p", true);
  setOpenOnHover("q", true);
});

afterEach(() => {
  cleanup();
  resetFooterWindowsForTests();
  vi.useRealTimers();
});

const leave = () => fireEvent.mouseMove(away());

describe("hover", () => {
  it("opens the window of an item whose plugin opens on hover", () => {
    fireEvent.mouseOver(button("A"));
    expect(a.calls).toEqual(["open"]);
  });

  it("leaves an item alone when its plugin opens on click only", () => {
    setOpenOnHover("q", false);
    fireEvent.mouseOver(button("C"));
    expect(c.calls).toEqual([]);
  });

  it("keeps the hovered window while the pointer is inside it", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.mouseMove(document.getElementById("mount")!);
    act(() => void vi.advanceTimersByTime(HOVER_LEAVE_MS * 2));
    expect(a.calls).toEqual(["open"]);
  });

  it("closes the hovered window at once when the pointer moves past the footer", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.mouseMove(away());
    expect(a.calls).toEqual(["open", "close"]);
  });

  it("closes the hovered window at once when the pointer leaves the app", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.mouseOut(button("A"), { relatedTarget: null });
    expect(a.calls).toEqual(["open", "close"]);
  });

  it("gives the pointer a grace period in the footer's gaps between the item and its window", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.mouseMove(document.querySelector('[data-sidebar="footer"]')!);
    expect(a.calls).toEqual(["open"]);
    act(() => void vi.advanceTimersByTime(HOVER_LEAVE_MS));
    expect(a.calls).toEqual(["open", "close"]);
  });

  it("gives the pointer a grace period inside an open overflow menu", () => {
    document.body.insertAdjacentHTML("beforeend", `<div role="menu"><div id="gap"></div></div>`);
    fireEvent.mouseOver(button("A"));
    fireEvent.mouseMove(document.getElementById("gap")!);
    expect(a.calls).toEqual(["open"]);
  });

  it("brings the pinned window back at once when the pointer moves past the footer from a hovered one", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
    fireEvent.mouseOver(button("C"));
    fireEvent.mouseMove(away());
    expect(a.calls).toEqual(["open", "open"]);
  });

  it("opens from the item's row in the overflow menu", () => {
    document.body.insertAdjacentHTML("beforeend", `<div role="menuitem" id="row">B</div>`);
    fireEvent.mouseOver(document.getElementById("row")!);
    expect(b.calls).toEqual(["open"]);
  });
});

describe("pin", () => {
  it("a click on a window opened by hover pins it without letting bb toggle it shut", () => {
    const host = vi.fn();
    button("A").addEventListener("click", host);
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
    leave();
    expect(host).not.toHaveBeenCalled();
    expect(a.calls).toEqual(["open"]);
  });

  it("a click on a closed item reaches bb, which opens it pinned", () => {
    setOpenOnHover("p", false);
    const host = vi.fn();
    button("A").addEventListener("click", host);
    fireEvent.click(button("A"));
    leave();
    expect(host).toHaveBeenCalledOnce();
    expect(a.calls).toEqual([]);
  });

  it("hovering another item shows its window, leaving brings the pinned one back", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
    fireEvent.mouseOver(button("C"));
    leave();
    expect(c.calls).toEqual(["open"]);
    expect(a.calls).toEqual(["open", "open"]);
  });

  it("a click inside a hovered window pins it, so leaving keeps it open", () => {
    const content = vi.fn();
    document.getElementById("mount")!.addEventListener("click", content);
    fireEvent.mouseOver(button("A"));
    fireEvent.click(document.getElementById("mount")!);
    leave();
    expect(content).toHaveBeenCalledOnce();
    expect(a.calls).toEqual(["open"]);
  });

  it("a click on another item pins that one, so leaving neither closes it nor brings the old one back", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
    fireEvent.mouseOver(button("C"));
    fireEvent.click(button("C"));
    leave();
    expect(c.calls).toEqual(["open"]);
    expect(a.calls).toEqual(["open"]);
  });

  it("a click on the pinned item reaches bb, which closes it, and the pin is gone", () => {
    const host = vi.fn();
    button("A").addEventListener("click", host);
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
    fireEvent.click(button("A"));
    expect(host).toHaveBeenCalledOnce();
    fireEvent.mouseOver(button("B"));
    leave();
    expect(b.calls).toEqual(["open", "close"]);
    expect(a.calls).toEqual(["open"]);
  });

  it("Escape forgets the pinned window", () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseOver(button("B"));
    leave();
    expect(b.calls).toEqual(["open", "close"]);
    expect(a.calls).toEqual(["open"]);
  });
});

describe("withFooterWindow", () => {
  const Panel = ({ dismiss }: { dismiss(): void }) => (
    <button type="button" onClick={dismiss}>
      close
    </button>
  );
  const Window = withFooterWindow(Panel, { pluginId: "p", itemId: "a" });
  const show = () => render(<Window dismiss={dismissed} />, { container: document.getElementById("mount")! });
  let dismissed: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    dismissed = vi.fn();
  });
  const handle = () => section().querySelector<HTMLElement>("[data-footer-window-handle]")!;
  const pin = () => {
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
  };

  it("draws a thin line on top instead of BB's frame and lifts the 320 px ceiling", () => {
    show();
    expect(section().style.borderTop).toContain("1px solid");
    expect(section().style.borderRadius).toBe("0px");
    expect(section().style.background).toBe("transparent");
    expect(frame().style.maxHeight).not.toBe("");
  });

  it("shows the resize handle only on a pinned window", () => {
    show();
    expect(handle().style.display).toBe("none");
    act(pin);
    expect(handle().style.display).toBe("block");
  });

  it("dragging the handle up makes the window taller and remembers the height for the item", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 200 } as DOMRect);
    show();
    act(pin);
    fireEvent.pointerDown(handle(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 440, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 440, pointerId: 1 });
    expect(frame().style.height).toBe("260px");
    expect(window.localStorage.getItem("bb-plugins.footer-window.height:p/a")).toBe("260");
  });

  it("a remembered height comes back when the item is pinned again", () => {
    window.localStorage.setItem("bb-plugins.footer-window.height:p/a", "300");
    show();
    act(pin);
    expect(frame().style.height).toBe("300px");
  });

  it("a double click on the handle makes the window hug its content again", () => {
    window.localStorage.setItem("bb-plugins.footer-window.height:p/a", "300");
    show();
    act(pin);
    fireEvent.doubleClick(handle());
    expect(frame().style.height).toBe("");
    expect(window.localStorage.getItem("bb-plugins.footer-window.height:p/a")).toBeNull();
  });

  it("an unpinned window hugs its content even with a remembered height", () => {
    window.localStorage.setItem("bb-plugins.footer-window.height:p/a", "300");
    show();
    expect(frame().style.height).toBe("");
  });

  it("dismiss from the window closes it and forgets the pin", () => {
    const view = show();
    act(pin);
    fireEvent.click(view.getByText("close"));
    expect(dismissed).toHaveBeenCalledOnce();
    fireEvent.mouseOver(button("B"));
    leave();
    expect(b.calls).toEqual(["open", "close"]);
  });

  it("a pinned window closed by someone else is forgotten, so leaving another item does not bring it back", () => {
    const view = show();
    act(pin);
    view.unmount();
    fireEvent.mouseOver(button("C"));
    leave();
    expect(a.calls).toEqual(["open"]);
    expect(c.calls).toEqual(["open", "close"]);
  });

  it("the pinned window unmounting because a hovered one replaced it keeps the pin", () => {
    const view = show();
    act(pin);
    fireEvent.mouseOver(button("C"));
    view.unmount();
    leave();
    expect(a.calls).toEqual(["open", "open"]);
  });

  it("pinning from the overflow menu row survives bb's toggle closing the window under the click", () => {
    // BB: one window at a time, mounted while open; the row's click toggles it.
    let view: ReturnType<typeof show> | null = null;
    const mount = () => {
      const container = frame().appendChild(document.createElement("div"));
      return render(<Window dismiss={dismissed} />, { container });
    };
    const bb: DisclosureController = {
      open: () => void (view ??= mount()),
      close: () => {
        view?.unmount();
        view?.container.remove();
        view = null;
      },
      toggle: () => undefined,
    };
    registerFooterWindow({ pluginId: "p", itemId: "a", label: "A" }, bb);
    registerFooterWindow({ pluginId: "q", itemId: "c", label: "C" }, { open: bb.close, close: () => undefined, toggle: () => undefined });
    document.body.insertAdjacentHTML("beforeend", `<div role="menuitem" id="row">A</div>`);
    const row = document.getElementById("row")!;
    const menu = vi.fn(() => act(bb.close));
    row.addEventListener("click", menu);

    act(() => void fireEvent.mouseOver(row));
    act(() => void fireEvent.click(row));
    act(() => void vi.advanceTimersByTime(0));
    expect(menu).toHaveBeenCalledOnce();
    expect(handle().style.display).toBe("block");

    act(() => void fireEvent.mouseOver(button("C")));
    act(leave);
    expect(handle().style.display).toBe("block");
  });

  it("gives BB's frame back when the window unmounts", () => {
    const view = show();
    view.unmount();
    expect(section().style.borderTop).toBe("");
    expect(frame().style.maxHeight).toBe("");
    expect(handle()).toBeNull();
  });
});
