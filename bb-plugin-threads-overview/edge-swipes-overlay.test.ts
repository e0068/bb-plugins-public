// @vitest-environment jsdom
//
// The overlay that hears the edges of the screen: registered with bb, alive
// only under a finger, and telling a thread from Home at the touch. What the
// swipes themselves do is pinned in edge-swipe.test; here is the wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

/** A coarse pointer, the way a phone reports itself, or a mouse. */
function stubPointer(coarse: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: coarse && query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

/** One pointer event of the finger at `x`. */
function pointer(type: string, x: number, on: EventTarget): void {
  on.dispatchEvent(
    new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: 300, bubbles: true }),
  );
}

async function renderOverlay(threadId: string | null) {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays.find((registration) => registration.id === "edge-swipes")!;
  return renderSlot(overlay, {}, { context: { threadId } });
}

/** A swipe to the left from the right edge; how far bb's page moved under it. */
function swipeFromRightEdge(): string {
  const edge = window.innerWidth - 4;
  pointer("pointerdown", edge, page);
  pointer("pointermove", edge - 100, document.body);
  const moved = page.style.translate;
  pointer("pointercancel", edge - 100, document.body);
  return moved;
}

let page: HTMLElement;

beforeEach(() => {
  stubPointer(true);
  page = document.createElement("main");
  page.setAttribute("data-sidebar", "inset");
  // On a phone bb's button for the right panel sits in the thread's header, known by its icon alone.
  const actions = document.createElement("div");
  actions.setAttribute("data-thread-header-pane-actions", "");
  actions.innerHTML = '<button type="button" aria-expanded="false"><svg data-icon="PanelRight"></svg></button>';
  page.append(actions);
  const shelf = document.createElement("div");
  shelf.setAttribute("data-testid", "secondary-panel-shelf");
  document.body.append(page, shelf);
});
afterEach(cleanup);
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the edge swipes overlay", () => {
  it("in a thread, gives the right edge to the thread's right panel", async () => {
    await renderOverlay("th_a");
    expect(swipeFromRightEdge()).toBe("-100px");
  });

  it("on Home, leaves the right edge to the rows", async () => {
    await renderOverlay(null);
    expect(swipeFromRightEdge()).toBe("");
  });

  it("hears nothing under a pointer that is not a finger", async () => {
    stubPointer(false);
    await renderOverlay("th_a");
    expect(swipeFromRightEdge()).toBe("");
  });

  it("stops hearing once it is gone", async () => {
    const slot = await renderOverlay("th_a");
    slot.unmount();
    expect(swipeFromRightEdge()).toBe("");
  });
});
