// @vitest-environment jsdom
//
// A swipe to the right from the left edge is bb's own: its left panel follows
// the finger. bb listens only to a finger put down past its floor and not on a
// field to type in, so any other is handed to bb's swipe, shifted onto that
// floor. The rule for the shift is pinned in src/core/edge-swipe.test; here is
// what bb hears. A swipe to the left from the right edge of a thread carries
// the thread's right panel, which bb opens only with its button.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BB_SIDEBAR_SWIPE_FLOOR } from "./src/core/edge-swipe";
import { watchEdgeSwipes } from "./edge-swipe";
import { PANEL_SETTLE_MS } from "./panel-swipe";

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

let inset: HTMLElement;
let root: HTMLElement;
let trigger: HTMLButtonElement;
let inThread: boolean;
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
  inThread = false;
  inset = document.createElement("main");
  inset.setAttribute("data-sidebar", "inset");
  root = document.createElement("section");
  root.setAttribute("data-threads-overview-section", "");
  trigger = document.createElement("button");
  trigger.setAttribute("data-sidebar", "trigger");
  trigger.addEventListener("click", () => (clicks += 1));
  inset.append(root);
  document.body.append(trigger, inset);
  // bb hears the press on the document's capture and the rest on the window.
  document.addEventListener("pointerdown", listen, true);
  for (const type of ["pointermove", "pointerup", "pointercancel"]) window.addEventListener(type, listen);
  stop = watchEdgeSwipes(() => inThread);
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

describe("a swipe to the right from the left edge over the composer of a thread", () => {
  let editor: HTMLElement;
  /** Where bb's own swipe heard the press. */
  let pressedOn: EventTarget | null;
  const notePress = (event: Event) => {
    if (event instanceof PointerEvent && event.pointerId !== FINGER) pressedOn = event.target;
  };

  beforeEach(() => {
    inThread = true;
    pressedOn = null;
    editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    inset.append(editor);
    document.addEventListener("pointerdown", notePress, true);
  });
  afterEach(() => document.removeEventListener("pointerdown", notePress, true));

  it("reaches bb's swipe, which refuses a finger on a field to type in, pressed on bb's page itself", () => {
    pointer("pointerdown", 30, editor);
    pointer("pointermove", 60);
    pointer("pointerup", 90);
    expect(heard.map(({ type, x }) => [type, x])).toEqual([
      ["pointerdown", 30],
      ["pointermove", 60],
      ["pointerup", 90],
    ]);
    expect(pressedOn).toBe(inset);
  });

  it("keeps the move from the page, so the draft does not scroll or select under it", () => {
    pointer("pointerdown", 30, editor);
    pointer("pointermove", 60);
    expect(touchMove(60, Y)).toBe(true);
  });

  it("is left to the selection while text in the composer is selected", () => {
    editor.textContent = "draft";
    const range = document.createRange();
    range.selectNodeContents(editor);
    document.getSelection()?.addRange(range);
    pointer("pointerdown", 30, editor);
    pointer("pointermove", 90);
    document.getSelection()?.removeAllRanges();
    expect(heard).toEqual([]);
  });
});

describe("what starts no edge swipe at all", () => {
  it("a touch while bb's left panel stands open", () => {
    inset.setAttribute("data-sidebar-shelf", "open");
    pointer("pointerdown", 4, root);
    pointer("pointermove", 90);
    expect(heard).toEqual([]);
  });

  it("a touch on bb's left panel itself", () => {
    const panel = document.createElement("div");
    panel.setAttribute("data-sidebar", "panel");
    document.body.append(panel);
    pointer("pointerdown", 4, panel);
    pointer("pointermove", 90);
    expect(heard).toEqual([]);
  });
});

describe("what is laid over bb's page", () => {
  it("a modal's backdrop, portaled beside the page", () => {
    const backdrop = document.createElement("div");
    document.body.append(backdrop);
    pointer("pointerdown", 4, backdrop);
    pointer("pointermove", 90);
    expect(heard).toEqual([]);
  });

  it("an alert dialog opened from inside the page", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    root.append(dialog);
    pointer("pointerdown", 4, dialog);
    pointer("pointermove", 90);
    expect(heard).toEqual([]);
  });

  it("what bb marks as no place for its swipe", () => {
    const button = document.createElement("button");
    button.setAttribute("data-no-sidebar-swipe", "");
    root.append(button);
    pointer("pointerdown", 4, button);
    pointer("pointermove", 90);
    expect(heard).toEqual([]);
  });
});

describe("a swipe to the left from the right edge of a thread", () => {
  const WIDTH = window.innerWidth;
  const EDGE = WIDTH - 4;
  let toggle: HTMLButtonElement;
  let shelf: HTMLElement;
  let presses: number;

  beforeEach(() => {
    vi.useFakeTimers();
    inThread = true;
    presses = 0;
    toggle = document.createElement("button");
    toggle.setAttribute("data-testid", "window-right-panel-toggle");
    toggle.setAttribute("aria-expanded", "false");
    // bb's button opens the panel: it pushes the page aside by its own class.
    toggle.addEventListener("click", () => {
      presses += 1;
      inset.setAttribute("data-panel-shelf", "full");
    });
    shelf = document.createElement("div");
    shelf.setAttribute("data-testid", "secondary-panel-shelf");
    shelf.setAttribute("data-state", "closed");
    document.body.append(toggle, shelf);
  });
  afterEach(() => vi.useRealTimers());

  it("pushes bb's page to the left under the finger and shows the panel beneath", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 100);
    expect(inset.style.translate).toBe("-100px");
    expect(shelf.style.visibility).toBe("visible");
    expect(touchMove(EDGE - 100, Y)).toBe(true);
  });

  it("let go past a third of the screen, presses bb's button at once and rides the page on to the open panel", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    expect(inset.style.translate).toBe(`${-WIDTH}px`);
    expect(presses).toBe(1);
    vi.advanceTimersByTime(PANEL_SETTLE_MS);
    expect([inset.style.translate, shelf.style.visibility, inset.style.zIndex]).toEqual(["", "", ""]);
  });

  it("keeps the page over the panel from the first move to the end of the ride, so bb's open panel never covers it mid-ride", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 100);
    expect(inset.style.zIndex).toBe("46");
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    vi.advanceTimersByTime(PANEL_SETTLE_MS - 1);
    expect(inset.style.zIndex).toBe("46");
  });

  it("holds the page where the ride left it until a slow bb stands its panel open, and never sends it back first", () => {
    const slow = document.createElement("button");
    slow.setAttribute("data-testid", "window-right-panel-toggle");
    slow.setAttribute("aria-expanded", "false");
    toggle.replaceWith(slow);
    let pressed = 0;
    slow.addEventListener("click", () => (pressed += 1));
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    expect(pressed).toBe(1);
    vi.advanceTimersByTime(PANEL_SETTLE_MS + 1000);
    expect(inset.style.translate).toBe(`${-WIDTH}px`);
    inset.setAttribute("data-panel-shelf", "full");
    vi.advanceTimersByTime(50);
    expect([inset.style.translate, inset.style.zIndex]).toEqual(["", ""]);
  });

  it("let go short of the threshold, rides the page back and leaves the panel closed", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 40);
    pointer("pointerup", EDGE - 40);
    expect(inset.style.translate).toBe("0px");
    vi.advanceTimersByTime(PANEL_SETTLE_MS);
    expect(presses).toBe(0);
    expect([inset.style.translate, shelf.style.visibility]).toEqual(["", ""]);
  });

  it("taken away mid-swipe, rides the page back however far it went", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointercancel", EDGE - WIDTH / 2);
    vi.advanceTimersByTime(PANEL_SETTLE_MS);
    expect(presses).toBe(0);
  });

  it("leaves a swipe to the right to the page", () => {
    pointer("pointerdown", WIDTH - 100, root);
    pointer("pointermove", WIDTH - 60);
    expect(touchMove(WIDTH - 60, Y)).toBe(false);
    expect(inset.style.translate).toBe("");
  });

  it("is not heard while the panel is already open", () => {
    toggle.setAttribute("aria-expanded", "true");
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 100);
    expect(inset.style.translate).toBe("");
  });

  it("leaves to the conversation a finger that set out scrolling it, however it wanders after", () => {
    pointer("pointerdown", EDGE, root);
    document.body.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: FINGER, pointerType: "touch", isPrimary: true, clientX: EDGE, clientY: Y + 30 }),
    );
    pointer("pointermove", EDGE - 40);
    expect(inset.style.translate).toBe("");
    expect(touchMove(EDGE - 40, Y)).toBe(false);
  });

  it("let go past the threshold and swiped again before the page arrives, opens the panel once and starts nothing new", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    vi.advanceTimersByTime(100);
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 100);
    vi.advanceTimersByTime(PANEL_SETTLE_MS);
    expect(presses).toBe(1);
    expect(inset.style.translate).toBe("");
  });

  it("let go short and swiped again before the page is back, keeps the new swipe's page where the finger is", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 40);
    pointer("pointerup", EDGE - 40);
    vi.advanceTimersByTime(100);
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 100);
    vi.advanceTimersByTime(PANEL_SETTLE_MS);
    expect(inset.style.translate).toBe("-100px");
  });

  it("stopped while the page rides off, hands the page to bb, which stands its panel open", () => {
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    stop();
    vi.advanceTimersByTime(PANEL_SETTLE_MS);
    expect(presses).toBe(1);
    expect([inset.style.translate, shelf.style.visibility]).toEqual(["", ""]);
  });

  it("lets a page held for a bb that never opens its panel go once the wait runs out", () => {
    const silent = document.createElement("button");
    silent.setAttribute("data-testid", "window-right-panel-toggle");
    silent.setAttribute("aria-expanded", "false");
    toggle.replaceWith(silent);
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    vi.advanceTimersByTime(PANEL_SETTLE_MS + 1900);
    expect(inset.style.translate).toBe(`${-WIDTH}px`);
    vi.advanceTimersByTime(200);
    expect([inset.style.translate, inset.style.zIndex]).toEqual(["", ""]);
  });

  it("stopped while it waits for a slow bb, hands the page over at once and then leaves it be", () => {
    const slow = document.createElement("button");
    slow.setAttribute("data-testid", "window-right-panel-toggle");
    slow.setAttribute("aria-expanded", "false");
    toggle.replaceWith(slow);
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    vi.advanceTimersByTime(PANEL_SETTLE_MS + 500);
    stop();
    expect([inset.style.translate, inset.style.zIndex]).toEqual(["", ""]);
    inset.style.translate = "-12px";
    vi.advanceTimersByTime(3000);
    expect(inset.style.translate).toBe("-12px");
  });

  it("put down on the panel mid-ride, leaves the page to bb's swipe to close it, lifted over the panel", () => {
    shelf.setAttribute("data-state", "full");
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - WIDTH / 2);
    pointer("pointerup", EDGE - WIDTH / 2);
    vi.advanceTimersByTime(PANEL_SETTLE_MS - 50);
    pointer("pointerdown", 150, shelf);
    // bb's own swipe to close the panel carries the page by its style.
    inset.style.translate = "-240px";
    vi.advanceTimersByTime(PANEL_SETTLE_MS);
    expect([inset.style.translate, inset.style.zIndex]).toEqual(["-240px", "46"]);
  });

  it("is not heard while bb's page stands pushed aside by the open panel", () => {
    inset.setAttribute("data-panel-shelf", "full");
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 100);
    expect(inset.style.translate).toBe("");
  });

  it("is not heard on Home, whose right edge is the rows'", () => {
    inThread = false;
    pointer("pointerdown", EDGE, root);
    pointer("pointermove", EDGE - 100);
    expect(inset.style.translate).toBe("");
  });
});

describe("a finger on the open right panel", () => {
  let shelf: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    inThread = true;
    inset.setAttribute("data-panel-shelf", "full");
    shelf = document.createElement("div");
    shelf.setAttribute("data-testid", "secondary-panel-shelf");
    shelf.setAttribute("data-state", "full");
    document.body.append(shelf);
  });
  afterEach(() => vi.useRealTimers());

  it("lifts bb's page over the panel, so bb's swipe to close it is seen bringing the thread in", () => {
    pointer("pointerdown", 150, shelf);
    expect(inset.style.zIndex).toBe("46");
  });

  it("keeps the page lifted while bb still carries it or still lays its panel over it, and puts it down once both are done", () => {
    pointer("pointerdown", 150, shelf);
    // bb's own swipe carries the page by its style, and rides it home after the lift.
    inset.style.translate = "-240px";
    pointer("pointermove", 300);
    pointer("pointerup", 300);
    vi.advanceTimersByTime(100);
    expect(inset.style.zIndex).toBe("46");
    inset.style.removeProperty("translate");
    vi.advanceTimersByTime(20);
    expect(inset.style.zIndex).toBe("46");
    inset.setAttribute("data-panel-shelf", "closed");
    vi.advanceTimersByTime(20);
    expect(inset.style.zIndex).toBe("");
  });

  it("puts the page down unseen once the wait runs out, the close called off and the page left off to the left", () => {
    pointer("pointerdown", 150, shelf);
    inset.style.translate = "-240px";
    pointer("pointerup", 300);
    inset.style.removeProperty("translate");
    vi.advanceTimersByTime(1900);
    expect(inset.style.zIndex).toBe("46");
    vi.advanceTimersByTime(200);
    expect(inset.style.zIndex).toBe("");
  });

  it("keeps nothing from bb: its swipe hears the finger as it is", () => {
    pointer("pointerdown", 150, shelf);
    pointer("pointermove", 300);
    expect(touchMove(300, Y)).toBe(false);
  });

  it("puts the page down for a touch that closed the panel without bb's swipe ever carrying it", () => {
    pointer("pointerdown", 150, shelf);
    inset.setAttribute("data-panel-shelf", "closed");
    pointer("pointerup", 150);
    expect(inset.style.zIndex).toBe("");
  });

  it("lifts nothing for a touch on bb's page while the panel is closed", () => {
    inset.setAttribute("data-panel-shelf", "closed");
    pointer("pointerdown", 150, shelf);
    expect(inset.style.zIndex).toBe("");
  });
});

describe("a sideways swipe from anywhere on the composer", () => {
  const MIDDLE = window.innerWidth / 2;
  let composer: HTMLElement;
  let editor: HTMLElement;
  let presses: number;

  beforeEach(() => {
    vi.useFakeTimers();
    presses = 0;
    composer = document.createElement("div");
    composer.setAttribute("data-app-composer", "");
    editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    composer.append(editor);
    inset.append(composer);
    const toggle = document.createElement("button");
    toggle.setAttribute("data-testid", "window-right-panel-toggle");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      presses += 1;
      inset.setAttribute("data-panel-shelf", "full");
    });
    const shelf = document.createElement("div");
    shelf.setAttribute("data-testid", "secondary-panel-shelf");
    document.body.append(toggle, shelf);
  });
  afterEach(() => vi.useRealTimers());

  it("to the right, reaches bb's swipe for its left panel, on Home and in a thread alike", () => {
    for (const thread of [false, true]) {
      inThread = thread;
      heard = [];
      pointer("pointerdown", MIDDLE, editor);
      pointer("pointermove", MIDDLE + 40);
      pointer("pointerup", MIDDLE + 80);
      expect(heard.map(({ type }) => type)).toEqual(["pointerdown", "pointermove", "pointerup"]);
    }
  });

  it("to the left in a thread, carries the right panel under the finger and opens it", () => {
    inThread = true;
    pointer("pointerdown", MIDDLE, editor);
    pointer("pointermove", MIDDLE - 100);
    expect(inset.style.translate).toBe("-100px");
    expect(touchMove(MIDDLE - 100, Y)).toBe(true);
    pointer("pointermove", MIDDLE - window.innerWidth / 2);
    pointer("pointerup", MIDDLE - window.innerWidth / 2);
    expect(presses).toBe(1);
  });

  it("to the left on Home, does nothing: there is no right panel there", () => {
    pointer("pointerdown", MIDDLE, editor);
    pointer("pointermove", MIDDLE - 100);
    expect([inset.style.translate, touchMove(MIDDLE - 100, Y)]).toEqual(["", false]);
    expect(heard).toEqual([]);
  });

  it("up or down, is left to the composer's own gestures", () => {
    inThread = true;
    pointer("pointerdown", MIDDLE, editor);
    document.body.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: FINGER, pointerType: "touch", isPrimary: true, clientX: MIDDLE, clientY: Y - 40 }),
    );
    pointer("pointermove", MIDDLE + 80);
    expect([inset.style.translate, touchMove(MIDDLE + 80, Y)]).toEqual(["", false]);
    expect(heard).toEqual([]);
  });

  it("leaves to the project pills under the composer their own sideways scroll", () => {
    const pills = document.createElement("div");
    pills.style.overflowX = "auto";
    Object.defineProperty(pills, "scrollWidth", { value: 800 });
    Object.defineProperty(pills, "clientWidth", { value: 300 });
    const pill = document.createElement("button");
    pills.append(pill);
    composer.append(pills);
    pointer("pointerdown", MIDDLE, pill);
    pointer("pointermove", MIDDLE + 80);
    expect([touchMove(MIDDLE + 80, Y), pills.style.overflowX]).toEqual([false, "auto"]);
    expect(heard).toEqual([]);
  });
});
