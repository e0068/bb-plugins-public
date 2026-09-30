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

  it("holds no listener on the home screen that could keep the page from scrolling", async () => {
    const listen = vi.spyOn(document, "addEventListener");
    await renderOverlay({ threadId: null });
    const holding = listen.mock.calls.filter(
      ([type, , options]) =>
        type.startsWith("touch") && !(typeof options === "object" && options.passive === true),
    );
    listen.mockRestore();
    expect(holding.map(([type]) => type)).toEqual([]);
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

  it("goes home from over the composer, draft or no draft", async () => {
    const slot = await renderOverlay();
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.textContent = "недописанное письмо";
    document.body.append(editor);
    drag(780, 660, { on: editor });
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
    editor.remove();
  });

  it("stops listening once it is gone", async () => {
    const slot = await renderOverlay();
    slot.unmount();
    drag(780, 660);
    expect(slot.navigateCalls).toEqual([]);
  });
});

describe("the thread screen carried home as a card", () => {
  /** bb's own layout root, the screen the card is made of. */
  function screen(): HTMLElement {
    const root = document.createElement("div");
    root.dataset.testid = "app-layout-root";
    document.body.append(root);
    return root;
  }

  afterEach(() => {
    document.querySelectorAll("[data-testid=app-layout-root]").forEach((node) => node.remove());
  });

  it("does not go home before the finger lets go", async () => {
    const slot = await renderOverlay();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    expect(slot.navigateCalls).toEqual([]);
    finger("touchend", 200, 660, document.body);
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
  });

  it("stays in the thread when the finger comes back down before letting go", async () => {
    const slot = await renderOverlay();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    finger("touchmove", 200, 760, document.body);
    finger("touchend", 200, 760, document.body);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("lifts, shrinks and rounds the screen while the finger climbs", async () => {
    await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    expect(root.style.transform).toContain("translateY(-120px)");
    expect(root.style.transform).toContain("scale(");
    expect(root.style.borderRadius).toBe("24px");
  });

  it("holds the page still under the finger while it carries the screen", async () => {
    await renderOverlay();
    finger("touchstart", 200, 780, document.body);
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(move, "touches", { value: [{ clientX: 200, clientY: 660 }] });
    document.body.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
  });

  it("puts the screen back in place when let go short of home", async () => {
    await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 740, document.body);
    expect(root.style.transform).not.toBe("");
    finger("touchend", 200, 740, document.body);
    expect(root.style.transform).toBe("");
  });

  it("leaves no card behind once it has gone home", async () => {
    await renderOverlay();
    const root = screen();
    drag(780, 660);
    expect(root.style.transform).toBe("");
    expect(root.style.borderRadius).toBe("");
  });

  it("puts the screen back when the system takes the gesture away", async () => {
    const slot = await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    finger("touchcancel", 200, 660, document.body);
    expect(root.style.transform).toBe("");
    expect(slot.navigateCalls).toEqual([]);
  });
});

describe("the card leaves nothing behind", () => {
  const CARD_STYLES = ["transform", "transformOrigin", "borderRadius", "overflow", "boxShadow", "transition"] as const;

  function screen(): HTMLElement {
    const root = document.createElement("div");
    root.dataset.testid = "app-layout-root";
    document.body.append(root);
    return root;
  }

  function bare(root: HTMLElement): boolean {
    return CARD_STYLES.every((property) => root.style[property] === "");
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll("[data-testid=app-layout-root]").forEach((node) => node.remove());
  });

  it("takes every trace of the card off once it has settled back", async () => {
    await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 740, document.body);
    finger("touchend", 200, 740, document.body);
    vi.advanceTimersByTime(250);
    expect(bare(root)).toBe(true);
  });

  it("lays the screen flat and lets the page move once the finger wanders sideways, and stays in the thread", async () => {
    const slot = await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 680, document.body);
    const sideways = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(sideways, "touches", { value: [{ clientX: 350, clientY: 680 }] });
    document.body.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(false);
    expect(root.style.transform).toContain("translateY(0px)");
    finger("touchend", 350, 680, document.body);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("carries the card smoothly up after a slow start in the dead zone and goes home", async () => {
    const slot = await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    const lifts = [779, 776, 772, 760, 720, 660].map((y) => {
      finger("touchmove", 200, y, document.body);
      return root.style.transform;
    });
    expect(lifts.slice(3)).toEqual([
      expect.stringContaining("translateY(-20px)"),
      expect.stringContaining("translateY(-60px)"),
      expect.stringContaining("translateY(-120px)"),
    ]);
    finger("touchend", 200, 660, document.body);
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
  });

  it("leaves a finger going down from the strip to the page, the screen flat", async () => {
    const slot = await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    const down = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "touches", { value: [{ clientX: 200, clientY: 790 }] });
    document.body.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(bare(root)).toBe(true);
    finger("touchend", 200, 790, document.body);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("leaves the page alone over a list that can still scroll, from the first move", async () => {
    await renderOverlay();
    const list = scroller(1200);
    finger("touchstart", 200, 780, list);
    const nudge = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(nudge, "touches", { value: [{ clientX: 200, clientY: 777 }] });
    list.dispatchEvent(nudge);
    expect(nudge.defaultPrevented).toBe(false);
    list.remove();
  });

  it("puts the screen back when a second finger comes down", async () => {
    const slot = await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    fingers("touchstart", [{ x: 200, y: 660 }, { x: 260, y: 700 }], document.body);
    expect(root.style.transform).toBe("");
    vi.advanceTimersByTime(250);
    expect(bare(root)).toBe(true);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("takes the card off when the overlay goes away mid-gesture", async () => {
    const slot = await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    slot.unmount();
    expect(bare(root)).toBe(true);
  });

  it("takes the card off when the overlay goes away while it settles back", async () => {
    const slot = await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 740, document.body);
    finger("touchend", 200, 740, document.body);
    slot.unmount();
    expect(bare(root)).toBe(true);
  });
});

describe("a finger on iOS, where one move nobody held hands the whole touch to the page", () => {
  /** bb's own layout root, the screen the card is made of. */
  function screen(): HTMLElement {
    const root = document.createElement("div");
    root.dataset.testid = "app-layout-root";
    document.body.append(root);
    return root;
  }

  /**
   * Play a finger the way WebKit delivers it: once a move has gone out without
   * anybody holding the page, the browser scrolls or bounces, and every move
   * after it arrives too late to stop.
   */
  function iosDrag(fromY: number, ys: readonly number[]): void {
    finger("touchstart", 200, fromY, document.body);
    let scrolling = false;
    for (const y of ys) {
      const move = new Event("touchmove", { bubbles: true, cancelable: !scrolling });
      Object.defineProperty(move, "touches", { value: [{ clientX: 200, clientY: y }] });
      document.body.dispatchEvent(move);
      scrolling = scrolling || !move.defaultPrevented;
    }
  }

  afterEach(() => {
    document.querySelectorAll("[data-testid=app-layout-root]").forEach((node) => node.remove());
  });

  it("carries the card from a conversation at its newest message up past the reach, and goes home", async () => {
    const slot = await renderOverlay();
    const root = screen();
    iosDrag(780, [776, 750, 700, 660]);
    expect(root.style.transform).toContain("translateY(-120px)");
    finger("touchend", 200, 660, document.body);
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
  });

  it("holds the page from the first pixel the finger climbs, yet leaves the screen standing in the dead zone", async () => {
    await renderOverlay();
    const root = screen();
    finger("touchstart", 200, 780, document.body);
    const nudge = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(nudge, "touches", { value: [{ clientX: 200, clientY: 777 }] });
    document.body.dispatchEvent(nudge);
    expect(nudge.defaultPrevented).toBe(true);
    expect(root.style.transform).toBe("");
  });

  it("keeps the card when the finger dips back into the dead zone and climbs again", async () => {
    const slot = await renderOverlay();
    const root = screen();
    iosDrag(780, [750, 776, 700, 660]);
    expect(root.style.transform).toContain("translateY(-120px)");
    finger("touchend", 200, 660, document.body);
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
  });
});

describe("bb's composer on the card", () => {
  /** Where the composer's holder stands stuck to the bottom, and where it would lie in the flow. */
  const STUCK_TOP = 700;
  const FLOW_TOP = 820;

  /**
   * bb's layout root with the thread's composer in a holder stuck to the
   * bottom of the conversation, as bb draws it. The holder measures where
   * sticky puts it, or where the flow and its offset put it once it is not
   * sticky; jsdom lays nothing out, so the two places are given.
   */
  function screenWithComposer(): { root: HTMLElement; holder: HTMLElement } {
    const root = document.createElement("div");
    root.dataset.testid = "app-layout-root";
    const holder = document.createElement("div");
    holder.style.position = "sticky";
    holder.getBoundingClientRect = () => {
      const top =
        holder.style.position === "sticky" ? STUCK_TOP : FLOW_TOP + (Number.parseFloat(holder.style.top) || 0);
      return { top, bottom: top + 100, height: 100 } as DOMRect;
    };
    const shell = document.createElement("div");
    shell.setAttribute("data-app-composer", "");
    shell.setAttribute("data-app-composer-role", "primary");
    const form = document.createElement("form");
    form.setAttribute("data-promptbox", "");
    form.setAttribute("data-promptbox-compact", "");
    shell.append(form);
    holder.append(shell);
    root.append(holder);
    document.body.append(root);
    return { root, holder };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll("[data-testid=app-layout-root]").forEach((node) => node.remove());
  });

  it("stands where it stood while the card is carried, not left to sticky, which WebKit places wrong under a scale", async () => {
    await renderOverlay();
    const { holder } = screenWithComposer();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    expect(holder.style.position).not.toBe("sticky");
    expect(holder.getBoundingClientRect().top).toBe(STUCK_TOP);
  });

  it("is stuck again once the card has settled back into the thread", async () => {
    await renderOverlay();
    const { holder } = screenWithComposer();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 740, document.body);
    finger("touchend", 200, 740, document.body);
    vi.advanceTimersByTime(250);
    expect(holder.style.position).toBe("sticky");
    expect(holder.style.top).toBe("");
  });

  it("is stuck again once the card has gone home", async () => {
    await renderOverlay();
    const { holder } = screenWithComposer();
    drag(780, 660);
    expect(holder.style.position).toBe("sticky");
    expect(holder.style.top).toBe("");
  });

  it("is stuck again when the overlay goes away mid-gesture", async () => {
    const slot = await renderOverlay();
    const { holder } = screenWithComposer();
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    slot.unmount();
    expect(holder.style.position).toBe("sticky");
    expect(holder.style.top).toBe("");
  });
});

describe("bb's composer on the card, over a conversation that moves under it", () => {
  /** The bottom of the conversation on the screen, the composer's height, and where it lies in the flow unscrolled. */
  const FLOOR = 900;
  const HEIGHT = 100;
  const FLOW_TOP = 820;
  const OWN_HEIGHT = 1000;

  /**
   * bb's layout root with the thread's composer stuck to the bottom of the
   * conversation that scrolls it, the whole shrunk by `scale` from the bottom.
   * jsdom lays nothing out, so the boxes are measured by hand: stuck, the
   * composer stands on the floor; out of sticky, it lies in the flow, moved by
   * its offset and by how far the conversation has scrolled since.
   */
  function screenWithConversation(scale: number) {
    const moved = { by: 0 };
    const root = document.createElement("div");
    root.dataset.testid = "app-layout-root";
    const conversation = document.createElement("div");
    conversation.style.overflowY = "auto";
    Object.defineProperty(conversation, "offsetHeight", { value: OWN_HEIGHT });
    conversation.getBoundingClientRect = () =>
      ({ top: FLOOR - OWN_HEIGHT * scale, bottom: FLOOR, height: OWN_HEIGHT * scale }) as DOMRect;
    const holder = document.createElement("div");
    holder.style.position = "sticky";
    holder.getBoundingClientRect = () => {
      const top =
        holder.style.position === "sticky"
          ? FLOOR - HEIGHT * scale
          : FLOW_TOP - moved.by + (Number.parseFloat(holder.style.top) || 0) * scale;
      return { top, bottom: top + HEIGHT * scale, height: HEIGHT * scale } as DOMRect;
    };
    const shell = document.createElement("div");
    shell.setAttribute("data-app-composer", "");
    shell.setAttribute("data-app-composer-role", "primary");
    const form = document.createElement("form");
    form.setAttribute("data-promptbox", "");
    form.setAttribute("data-promptbox-compact", "");
    shell.append(form);
    holder.append(shell);
    conversation.append(holder);
    root.append(conversation);
    document.body.append(root);
    /** The conversation moves its content up by `by` px on the screen, as a scroll or a message changing does. */
    const scroll = (by: number) => {
      moved.by += by;
      conversation.dispatchEvent(new Event("scroll"));
    };
    return { holder, scroll };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.querySelectorAll("[data-testid=app-layout-root]").forEach((node) => node.remove());
  });

  it("stays on the bottom of the conversation when it scrolls under the carried card", async () => {
    await renderOverlay();
    const { holder, scroll } = screenWithConversation(1);
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    scroll(130);
    expect(holder.getBoundingClientRect().bottom).toBeCloseTo(FLOOR);
    scroll(-60);
    expect(holder.getBoundingClientRect().bottom).toBeCloseTo(FLOOR);
  });

  it("stays on the bottom of the shrunk conversation when it has moved between two moves of the finger", async () => {
    await renderOverlay();
    const { holder } = screenWithConversation(0.85);
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    holder.getBoundingClientRect = ((measure) => () => {
      const box = measure();
      return { ...box, top: box.top - 40, bottom: box.bottom - 40 } as DOMRect;
    })(holder.getBoundingClientRect);
    finger("touchmove", 200, 640, document.body);
    expect(holder.getBoundingClientRect().bottom).toBeCloseTo(FLOOR);
  });

  it("stays on the bottom of the conversation when a message changes size under a finger standing still", async () => {
    const watching: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly heard: () => void) {}
        observe() {
          watching.push(this.heard);
        }
        disconnect() {}
      },
    );
    await renderOverlay();
    const { holder } = screenWithConversation(0.85);
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 660, document.body);
    holder.getBoundingClientRect = ((measure) => () => {
      const box = measure();
      return { ...box, top: box.top + 60, bottom: box.bottom + 60 } as DOMRect;
    })(holder.getBoundingClientRect);
    watching.forEach((heard) => heard());
    expect(holder.getBoundingClientRect().bottom).toBeCloseTo(FLOOR);
    vi.unstubAllGlobals();
  });

  it("is no longer moved by the conversation once the card has settled back", async () => {
    await renderOverlay();
    const { holder, scroll } = screenWithConversation(1);
    finger("touchstart", 200, 780, document.body);
    finger("touchmove", 200, 740, document.body);
    finger("touchend", 200, 740, document.body);
    vi.advanceTimersByTime(250);
    scroll(130);
    expect(holder.style.position).toBe("sticky");
    expect(holder.style.top).toBe("");
  });
});
