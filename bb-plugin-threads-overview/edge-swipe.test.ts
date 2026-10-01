// @vitest-environment jsdom
//
// A swipe to the right from the left edge of Home is bb's own: its left panel
// follows the finger. bb listens only to a finger put down past its floor, so
// one put down nearer the edge is handed to bb's swipe shifted onto that floor.
// The rule for the shift is pinned in src/core/edge-swipe.test; here is what
// bb hears.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BB_SIDEBAR_SWIPE_FLOOR } from "./src/core/edge-swipe";
import { watchEdgeSwipes } from "./edge-swipe";

const FINGER = 1;
const Y = 300;

/** One pointer event of the finger, the way a phone reports it. */
function pointer(type: string, x: number, on: EventTarget = document.body): void {
  on.dispatchEvent(
    new PointerEvent(type, {
      pointerId: FINGER,
      pointerType: "touch",
      isPrimary: true,
      clientX: x,
      clientY: Y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** The finger's touch moving to a point, and whether the page was told to hold it; jsdom ships no TouchEvent. */
function touchMove(x: number, y: number): boolean {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: y }] });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
}

/** What bb's own swipe hears: every pointer event that is not the finger's. */
interface Heard {
  readonly type: string;
  readonly x: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
}

let root: HTMLElement;
let trigger: HTMLButtonElement;
let heard: Heard[];
let clicks: number;
let stop: () => void;

const listen = (event: Event) => {
  if (!(event instanceof PointerEvent) || event.pointerId === FINGER) return;
  const { type, clientX: x, pointerId, pointerType, isPrimary } = event;
  heard.push({ type, x, pointerId, pointerType, isPrimary });
};

beforeEach(() => {
  heard = [];
  clicks = 0;
  root = document.createElement("section");
  trigger = document.createElement("button");
  trigger.setAttribute("data-sidebar", "trigger");
  trigger.addEventListener("click", () => (clicks += 1));
  document.body.append(trigger, root);
  // bb hears the press on the document's capture and the rest on the window.
  document.addEventListener("pointerdown", listen, true);
  for (const type of ["pointermove", "pointerup", "pointercancel"]) window.addEventListener(type, listen);
  stop = watchEdgeSwipes(root);
});

afterEach(() => {
  stop();
  document.removeEventListener("pointerdown", listen, true);
  for (const type of ["pointermove", "pointerup", "pointercancel"]) window.removeEventListener(type, listen);
  document.body.replaceChildren();
});

describe("a swipe to the right from nearer the edge than bb listens", () => {
  it("reaches bb as its own swipe, shifted onto bb's floor and followed move by move", () => {
    pointer("pointerdown", 4, root);
    pointer("pointermove", 10);
    pointer("pointermove", 60);
    pointer("pointerup", 60);
    const shift = BB_SIDEBAR_SWIPE_FLOOR - 4;
    expect(heard.map(({ type, x }) => [type, x])).toEqual([
      ["pointerdown", 4 + shift],
      ["pointermove", 10 + shift],
      ["pointermove", 60 + shift],
      ["pointerup", 60 + shift],
    ]);
  });

  it("comes as one touch of its own, primary, that is not the finger's", () => {
    pointer("pointerdown", 4, root);
    pointer("pointermove", 30);
    pointer("pointerup", 30);
    const ids = new Set(heard.map((event) => event.pointerId));
    expect(ids.size).toBe(1);
    expect(heard.every((event) => event.pointerType === "touch" && event.isPrimary)).toBe(true);
  });

  it("no longer waits for the lift to open the panel with bb's button", () => {
    pointer("pointerdown", 4, root);
    pointer("pointermove", 120);
    pointer("pointerup", 120);
    expect(clicks).toBe(0);
  });

  it("is called off for bb when the finger is taken away", () => {
    pointer("pointerdown", 4, root);
    pointer("pointermove", 40);
    pointer("pointercancel", 40);
    expect(heard.at(-1)?.type).toBe("pointercancel");
  });

  it("keeps the page held to the end, even once the finger wanders more down than right", () => {
    pointer("pointerdown", 4, root);
    pointer("pointermove", 100);
    const first = touchMove(100, Y);
    document.body.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: FINGER, pointerType: "touch", isPrimary: true, clientX: 120, clientY: Y + 150 }),
    );
    expect([first, touchMove(120, Y + 150)]).toEqual([true, true]);
  });

  it("is called off for bb when a second finger comes down mid-swipe", () => {
    pointer("pointerdown", 4, root);
    pointer("pointermove", 90);
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 200, bubbles: true }),
    );
    expect(heard.filter((event) => event.pointerId !== 2).at(-1)?.type).toBe("pointercancel");
  });

  it("is called off for bb at the next touch when its lift went unheard", () => {
    pointer("pointerdown", 4, root);
    pointer("pointermove", 90);
    pointer("pointerdown", 160, root);
    expect(heard.at(-1)?.type).toBe("pointercancel");
  });
});

describe("what bb is not handed", () => {
  it("a swipe to the left from the edge, which is the slides'", () => {
    pointer("pointerdown", 20, root);
    pointer("pointermove", 2);
    pointer("pointerup", 2);
    expect(heard).toEqual([]);
  });

  it("an upright drag from the edge, which is the page's", () => {
    pointer("pointerdown", 4, root);
    document.body.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: FINGER, pointerType: "touch", isPrimary: true, clientX: 10, clientY: Y + 80 }),
    );
    const held = touchMove(10, Y + 80);
    pointer("pointerup", 10);
    expect({ held, heard }).toEqual({ held: false, heard: [] });
  });

  it("a tap at the edge", () => {
    pointer("pointerdown", 4, root);
    pointer("pointerup", 4);
    expect(heard).toEqual([]);
  });

  it("a touch that puts an open row away, which is spent on that alone", () => {
    const open = document.createElement("div");
    open.setAttribute("data-swipe-open", "");
    root.append(open);
    pointer("pointerdown", 4, root);
    pointer("pointermove", 90);
    pointer("pointerup", 90);
    expect(heard).toEqual([]);
  });

  it("a finger bb already takes by itself", () => {
    pointer("pointerdown", BB_SIDEBAR_SWIPE_FLOOR, root);
    pointer("pointermove", 90);
    pointer("pointerup", 90);
    expect(heard).toEqual([]);
  });
});
