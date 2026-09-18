// @vitest-environment jsdom
//
// The gesture that leaves a thread: a finger from the bottom edge pushed up
// takes the screen home. The rule itself is pinned in src/core/home-swipe.test;
// here is what the app-wide overlay does with it — when it listens, when it
// keeps out of the way, and that it goes home through bb's own navigation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

/** A coarse pointer, the way a phone or tablet reports itself. */
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

/** Fingers at points: jsdom ships no TouchEvent, so the touch list is hung on a plain event. */
function fingers(
  type: string,
  points: readonly { x: number; y: number }[],
  on: Element,
  cancelable = true,
): void {
  const event = new Event(type, { bubbles: true, cancelable });
  Object.defineProperty(event, "touches", {
    value: points.map((point) => ({ clientX: point.x, clientY: point.y })),
  });
  on.dispatchEvent(event);
}

/** One finger, the usual case. */
function finger(type: string, x: number, y: number, on: Element, cancelable = true): void {
  fingers(type, type === "touchend" ? [] : [{ x, y }], on, cancelable);
}

/** Put a finger down at `fromY` and drag it to `toY`, both at the same x unless told otherwise. */
function drag(
  fromY: number,
  toY: number,
  options: { x?: number; toX?: number; on?: Element; cancelable?: boolean } = {},
) {
  const x = options.x ?? 200;
  const on = options.on ?? document.body;
  const toX = options.toX ?? x;
  finger("touchstart", x, fromY, on);
  finger("touchmove", toX, toY, on, options.cancelable ?? true);
  finger("touchend", toX, toY, on);
}

/** A box that scrolls, with `room` pixels of content left below what it shows. */
function scroller(room: number): HTMLElement {
  const box = document.createElement("div");
  box.style.overflowY = "auto";
  Object.defineProperty(box, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(box, "scrollHeight", { configurable: true, value: 400 + room });
  Object.defineProperty(box, "scrollTop", { configurable: true, value: 0 });
  document.body.append(box);
  return box;
}

async function renderOverlay(
  context: { projectId?: string | null; threadId?: string | null } = { threadId: "th_a" },
) {
  const app = await loadPluginApp(() => import("./app"));
  // By id, not by position: another overlay one day must not quietly retarget these tests.
  const overlay = app.appOverlays.find((registration) => registration.id === "home-swipe")!;
  return renderSlot(overlay, {}, { context });
}

beforeEach(() => {
  stubPointer(true);
  window.innerHeight = 800;
});
afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

describe("swipe up from the bottom edge of a thread", () => {
  it("goes home", async () => {
    const slot = await renderOverlay();
    drag(780, 660);
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
  });

  it("stays in the thread when the finger starts up the screen", async () => {
    const slot = await renderOverlay();
    drag(400, 200);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("stays in the thread when the finger barely moves", async () => {
    const slot = await renderOverlay();
    drag(780, 760);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("leaves a swipe that goes sideways to whoever wants it", async () => {
    const slot = await renderOverlay();
    drag(780, 700, { x: 300, toX: 100 });
    expect(slot.navigateCalls).toEqual([]);
  });

  it("does nothing on the home screen, where there is nowhere to go", async () => {
    const slot = await renderOverlay({ threadId: null });
    drag(780, 660);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("does nothing under a pointer that is not a finger", async () => {
    stubPointer(false);
    const slot = await renderOverlay();
    drag(780, 660);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("leaves a flick that a list under the finger can still scroll to that list", async () => {
    const slot = await renderOverlay();
    const list = scroller(1200);
    drag(780, 660, { on: list });
    expect(slot.navigateCalls).toEqual([]);
    list.remove();
  });

  it("goes home from a conversation that rests at its newest message", async () => {
    const slot = await renderOverlay();
    const list = scroller(0);
    drag(780, 660, { on: list });
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
    list.remove();
  });

  it("stands aside once the browser has taken the move for a scroll", async () => {
    const slot = await renderOverlay();
    drag(780, 660, { cancelable: false });
    expect(slot.navigateCalls).toEqual([]);
  });

  it("does not go home under two fingers", async () => {
    const slot = await renderOverlay();
    finger("touchstart", 200, 780, document.body);
    fingers("touchstart", [{ x: 200, y: 780 }, { x: 260, y: 770 }], document.body);
    fingers("touchmove", [{ x: 200, y: 660 }, { x: 260, y: 650 }], document.body);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("forgets a gesture the system takes away", async () => {
    const slot = await renderOverlay();
    finger("touchstart", 200, 780, document.body);
    finger("touchcancel", 200, 770, document.body);
    finger("touchmove", 200, 660, document.body);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("leaves a drag inside the composer to the composer", async () => {
    const slot = await renderOverlay();
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(editor);
    drag(780, 660, { on: editor });
    expect(slot.navigateCalls).toEqual([]);
    editor.remove();
  });

  it("draws nothing of its own", async () => {
    const slot = await renderOverlay();
    expect(slot.container.innerHTML).toBe("");
  });

  it("stops listening once it is gone", async () => {
    const slot = await renderOverlay();
    slot.unmount();
    drag(780, 660);
    expect(slot.navigateCalls).toEqual([]);
  });
});
