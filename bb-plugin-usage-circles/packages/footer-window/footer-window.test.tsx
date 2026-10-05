// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOVER_LEAVE_MS,
  registerFooterWindow,
  resetFooterWindowsForTests,
  setOpenOnHover,
  togglePin,
  useHoldHeight,
  withFooterWindow,
  type DisclosureController,
} from "./footer-window";
import { FooterWindow } from "./window-view";

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
/** Hover A, then press the pin in its window's header. */
const pinA = () => {
  fireEvent.mouseOver(button("A"));
  togglePin({ pluginId: "p", itemId: "a" });
};

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
    pinA();
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
  it("a click on a window opened by hover keeps it open without pinning it, and bb never sees the click", () => {
    const host = vi.fn();
    button("A").addEventListener("click", host);
    fireEvent.mouseOver(button("A"));
    fireEvent.click(button("A"));
    expect(host).not.toHaveBeenCalled();
    leave();
    expect(a.calls).toEqual(["open", "close"]);
  });

  it("a click on a closed item reaches bb, which opens it unpinned, so leaving closes it", () => {
    setOpenOnHover("p", false);
    const host = vi.fn();
    button("A").addEventListener("click", host);
    fireEvent.click(button("A"));
    expect(host).toHaveBeenCalledOnce();
    leave();
    expect(a.calls).toEqual(["close"]);
  });

  it("hovering another item shows its window, leaving brings the pinned one back", () => {
    pinA();
    fireEvent.mouseOver(button("C"));
    leave();
    expect(c.calls).toEqual(["open"]);
    expect(a.calls).toEqual(["open", "open"]);
  });

  it("a click inside a hovered window leaves it unpinned: only the pin in its header pins it", () => {
    const content = vi.fn();
    document.getElementById("mount")!.addEventListener("click", content);
    fireEvent.mouseOver(button("A"));
    fireEvent.click(document.getElementById("mount")!);
    leave();
    expect(content).toHaveBeenCalledOnce();
    expect(a.calls).toEqual(["open", "close"]);
  });

  it("a click on another item over the pinned one keeps the pin, so leaving brings the pinned one back", () => {
    pinA();
    fireEvent.mouseOver(button("C"));
    fireEvent.click(button("C"));
    leave();
    expect(c.calls).toEqual(["open"]);
    expect(a.calls).toEqual(["open", "open"]);
  });

  it("a click on the pinned item reaches bb, which closes it, and the pin is gone", () => {
    const host = vi.fn();
    button("A").addEventListener("click", host);
    pinA();
    fireEvent.click(button("A"));
    expect(host).toHaveBeenCalledOnce();
    fireEvent.mouseOver(button("B"));
    leave();
    expect(b.calls).toEqual(["open", "close"]);
    expect(a.calls).toEqual(["open"]);
  });

  it("Escape forgets the pinned window", () => {
    pinA();
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
  const pin = pinA;

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

  it("pinning fixes the window at the height it shows at that moment, not at one remembered before", () => {
    window.localStorage.setItem("bb-plugins.footer-window.height:p/a", "300");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 180 } as DOMRect);
    show();
    act(pin);
    expect(frame().style.height).toBe("180px");
  });

  it("a held window keeps the height it shows, stays unpinned and closes when the pointer leaves", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 150 } as DOMRect);
    let hold = () => undefined as void;
    const Holding = withFooterWindow(
      () => {
        hold = useHoldHeight();
        return null;
      },
      { pluginId: "p", itemId: "a" },
    );
    fireEvent.mouseOver(button("A"));
    render(<Holding dismiss={dismissed} />, { container: document.getElementById("mount")! });
    act(() => hold());
    expect(frame().style.height).toBe("150px");
    expect(handle().style.display).toBe("none");
    leave();
    expect(a.calls).toEqual(["open", "close"]);
  });

  it("holding outside a footer window does nothing", () => {
    let hold = () => undefined as void;
    const Plain = () => {
      hold = useHoldHeight();
      return null;
    };
    render(<Plain />);
    expect(() => hold()).not.toThrow();
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

  it("a click on the overflow menu row brings back the window bb's toggle shut under the click, unpinned", () => {
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
    expect(handle().style.display).toBe("none");

    act(leave);
    expect(view).toBeNull();
  });

  it("gives BB's frame back when the window unmounts", () => {
    const view = show();
    view.unmount();
    expect(section().style.borderTop).toBe("");
    expect(frame().style.maxHeight).toBe("");
    expect(handle()).toBeNull();
  });
});

describe("window header", () => {
  const Window = withFooterWindow(
    () => (
      <FooterWindow title="Alpha" count={3}>
        <p>body</p>
      </FooterWindow>
    ),
    { pluginId: "p", itemId: "a" },
  );
  const show = () => render(<Window dismiss={() => undefined} />, { container: document.getElementById("mount")! });

  it("shows the title, the count and the way to the plugin's settings", () => {
    const view = show();
    expect(view.getByRole("heading").textContent).toBe("Alpha");
    expect(view.getByText("3")).toBeTruthy();
    expect(view.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings/plugins/p");
  });

  it("the pin pins a hovered window, so leaving keeps it, and a second press unpins it", () => {
    fireEvent.mouseOver(button("A"));
    const view = show();
    fireEvent.click(view.getByRole("button", { name: "Pin" }));
    leave();
    expect(a.calls).toEqual(["open"]);
    fireEvent.click(view.getByRole("button", { name: "Unpin" }));
    leave();
    expect(a.calls).toEqual(["open", "close"]);
  });
});

describe("unpinning", () => {
  const Window = withFooterWindow(() => <FooterWindow title="Alpha" />, { pluginId: "p", itemId: "a" });

  it("keeps the window at the height it shows, so its header stays under the pointer, and leaving then closes it", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 180 } as DOMRect);
    fireEvent.mouseOver(button("A"));
    const view = render(<Window dismiss={() => undefined} />, { container: document.getElementById("mount")! });
    fireEvent.click(view.getByRole("button", { name: "Pin" }));
    fireEvent.click(view.getByRole("button", { name: "Unpin" }));
    expect(frame().style.height).toBe("180px");
    leave();
    expect(a.calls).toEqual(["open", "close"]);
  });
});

describe("header buttons", () => {
  const actions = [
    { id: "read", label: "Read all", icon: null, onClick: () => undefined },
    { id: "show", label: "Show read", icon: null, onClick: () => undefined, pressed: false },
  ];
  const Window = withFooterWindow(() => <FooterWindow title="Alpha" actions={actions} />, { pluginId: "p", itemId: "a" });

  it("an action is announced as a plain button; a toggle and the pin keep their pressed state", () => {
    fireEvent.mouseOver(button("A"));
    const view = render(<Window dismiss={() => undefined} />, { container: document.getElementById("mount")! });
    expect(view.getByRole("button", { name: "Read all" }).hasAttribute("aria-pressed")).toBe(false);
    expect(view.getByRole("button", { name: "Show read" }).getAttribute("aria-pressed")).toBe("false");
    expect(view.getByRole("button", { name: "Pin" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("unpinning a window held before", () => {
  it("keeps the height it shows at the moment of unpinning, not the one held before it was pinned", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 150 } as DOMRect);
    let hold = () => undefined as void;
    const Holding = withFooterWindow(
      () => {
        hold = useHoldHeight();
        return <FooterWindow title="Alpha" />;
      },
      { pluginId: "p", itemId: "a" },
    );
    fireEvent.mouseOver(button("A"));
    const view = render(<Holding dismiss={() => undefined} />, { container: document.getElementById("mount")! });
    act(() => hold());
    fireEvent.click(view.getByRole("button", { name: "Pin" }));
    const grip = section().querySelector<HTMLElement>("[data-footer-window-handle]")!;
    fireEvent.pointerDown(grip, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 250, pointerId: 1 });
    rect.mockReturnValue({ height: 400 } as DOMRect);
    fireEvent.click(view.getByRole("button", { name: "Unpin" }));
    expect(frame().style.height).toBe("400px");
  });
});
