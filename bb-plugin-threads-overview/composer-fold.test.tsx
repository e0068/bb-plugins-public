// @vitest-environment jsdom
//
// Folding bb's composer with a finger: pulled down, it shrinks with the finger;
// let go far enough down, it folds to one line and the keyboard goes away; let
// go short of that, it stands back up with the keyboard still out. The rule is
// pinned in src/core/composer-fold.test; here is what the overlay does with a
// real composer on the page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

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

/** One finger at a point on `on`; jsdom ships no TouchEvent, so the touch list is hung on a plain event. */
function finger(type: string, y: number, on: Element, cancelable = true): Event {
  const event = new Event(type, { bubbles: true, cancelable });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: 200, clientY: y }],
  });
  on.dispatchEvent(event);
  return event;
}

interface Composer {
  readonly form: HTMLFormElement;
  readonly draft: HTMLElement;
  readonly editor: HTMLElement;
}

/** bb's composer as it stands on the page, `height` px tall, `under` a parent — the page unless told. */
function drawComposer(height: number, under: Element = document.body): Composer {
  const shell = document.createElement("div");
  shell.setAttribute("data-app-composer", "");
  shell.setAttribute("data-app-composer-role", "primary");
  const form = document.createElement("form");
  form.setAttribute("data-promptbox", "");
  form.getBoundingClientRect = () => ({ height, top: 800 - height, bottom: 800 }) as DOMRect;
  const draft = document.createElement("div");
  draft.setAttribute("data-promptbox-editor-scroll", "");
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.tabIndex = 0;
  draft.append(editor);
  form.append(draft);
  shell.append(form);
  under.append(shell);
  return { form, draft, editor };
}

async function renderOverlay(context: { threadId?: string | null } = { threadId: "th_a" }) {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays.find((registration) => registration.id === "composer-fold")!;
  return renderSlot(overlay, {}, { context });
}

/** Pull the composer from y 600 down to `to`, without letting go. */
function pull(composer: Composer, to: number): Event {
  finger("touchstart", 600, composer.editor);
  return finger("touchmove", to, composer.editor);
}

function folded(composer: Composer): boolean {
  return composer.form.hasAttribute("data-composer-folded");
}

beforeEach(() => {
  stubPointer(true);
  window.innerHeight = 800;
});
afterEach(cleanup);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a composer pulled down past the reach", () => {
  it("folds to one line", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    expect(folded(composer)).toBe(true);
  });

  it("puts the keyboard away", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    expect(document.activeElement).not.toBe(composer.editor);
  });

  it("puts the keyboard away from a composer already one line tall", async () => {
    const composer = drawComposer(48);
    await renderOverlay();
    composer.editor.focus();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    expect(document.activeElement).not.toBe(composer.editor);
  });

  it("folds on Home too", async () => {
    const composer = drawComposer(180);
    await renderOverlay({ threadId: null });
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    expect(folded(composer)).toBe(true);
  });
});

describe("a composer under a finger pulling it down", () => {
  it("shrinks by as far as the finger has gone", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    pull(composer, 650);
    expect(composer.form.style.maxHeight).toBe("130px");
  });

  it("holds the page still under the finger", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    expect(pull(composer, 603).defaultPrevented).toBe(true);
  });

  it("stands aside once the browser has taken the move for a scroll", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 670, composer.editor, false);
    finger("touchend", 670, composer.editor);
    expect(folded(composer)).toBe(false);
  });
});

describe("a composer with text selected in it", () => {
  /** Select the text of the draft, the way a long press does, keyboard out. */
  function selectDraft(composer: Composer): void {
    composer.editor.textContent = "первая строка\nвторая строка\nтретья строка";
    composer.editor.focus();
    const range = document.createRange();
    range.selectNodeContents(composer.editor);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  }

  it("stays as it stands under a finger dragging the selection down", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    selectDraft(composer);
    const move = pull(composer, 670);
    finger("touchend", 670, composer.editor);

    expect(move.defaultPrevented).toBe(false);
    expect(composer.form.style.maxHeight).toBe("");
    expect(folded(composer)).toBe(false);
    expect(document.activeElement).toBe(composer.editor);
  });

  it("stays as it stands when the selection begins mid-touch, at a long press", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    finger("touchstart", 600, composer.editor);
    selectDraft(composer);
    finger("touchmove", 670, composer.editor);
    finger("touchend", 670, composer.editor);

    expect(folded(composer)).toBe(false);
  });

  it("folds again once the selection is gone", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    selectDraft(composer);
    document.getSelection()!.collapseToEnd();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);

    expect(folded(composer)).toBe(true);
  });
});

describe("a composer let go short of the reach", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("stands back up whole, keyboard still out", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    pull(composer, 630);
    finger("touchend", 630, composer.editor);
    vi.advanceTimersByTime(250);
    expect(folded(composer)).toBe(false);
    expect(composer.form.style.maxHeight).toBe("");
    expect(document.activeElement).toBe(composer.editor);
  });

  it("stands back up when the system takes the touch away", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    pull(composer, 670);
    finger("touchcancel", 670, composer.editor);
    vi.advanceTimersByTime(250);
    expect(folded(composer)).toBe(false);
    expect(composer.form.style.maxHeight).toBe("");
  });
});

describe("a folded composer", () => {
  it("opens again at a tap, the keyboard with it", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    composer.editor.focus();
    expect(folded(composer)).toBe(false);
  });
});

describe("where the fold keeps out", () => {
  it("leaves a draft scrolled past its first line to scroll back", async () => {
    const composer = drawComposer(180);
    Object.defineProperty(composer.draft, "scrollTop", { configurable: true, value: 120 });
    await renderOverlay();
    expect(pull(composer, 670).defaultPrevented).toBe(false);
    finger("touchend", 670, composer.editor);
    expect(folded(composer)).toBe(false);
  });

  it("leaves a one-line composer nobody is typing into alone", async () => {
    const composer = drawComposer(48);
    await renderOverlay();
    expect(pull(composer, 670).defaultPrevented).toBe(false);
  });

  it("leaves the composer under the home swipe's card alone", async () => {
    const layer = document.createElement("div");
    layer.setAttribute("data-home-swipe-home", "");
    document.body.append(layer);
    const composer = drawComposer(180, layer);
    await renderOverlay();
    expect(pull(composer, 670).defaultPrevented).toBe(false);
  });

  it("does nothing under a pointer that is not a finger", async () => {
    stubPointer(false);
    vi.resetModules();
    const composer = drawComposer(180);
    await renderOverlay();
    expect(pull(composer, 670).defaultPrevented).toBe(false);
  });

  it("holds no touch on the page outside the composer", async () => {
    drawComposer(180);
    await renderOverlay();
    finger("touchstart", 600, document.body);
    expect(finger("touchmove", 670, document.body).defaultPrevented).toBe(false);
  });

  it("stops listening once it is gone, and takes the fold off", async () => {
    const composer = drawComposer(180);
    const slot = await renderOverlay();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    slot.unmount();
    expect(folded(composer)).toBe(false);
    expect(pull(composer, 670).defaultPrevented).toBe(false);
  });
});

describe("the composer found wherever bb draws it", () => {
  it("folds a composer drawn after the overlay, as a new screen draws its own", async () => {
    await renderOverlay();
    const composer = drawComposer(180);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    expect(folded(composer)).toBe(true);
  });
});

describe("a composer already drawn as one line", () => {
  it("is not pulled again once folded, border and all", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    composer.form.getBoundingClientRect = () => ({ height: 50, top: 750, bottom: 800 }) as DOMRect;
    expect(pull(composer, 670).defaultPrevented).toBe(false);
    expect(composer.form.style.maxHeight).toBe("");
  });

  it("is left to bb when bb has made it compact itself", async () => {
    const composer = drawComposer(50);
    composer.form.setAttribute("data-promptbox-compact", "");
    await renderOverlay();
    expect(pull(composer, 670).defaultPrevented).toBe(false);
  });

  it("still puts the keyboard away when typed into", async () => {
    const composer = drawComposer(50);
    composer.form.setAttribute("data-promptbox-compact", "");
    await renderOverlay();
    composer.editor.focus();
    pull(composer, 670);
    finger("touchend", 670, composer.editor);
    expect(document.activeElement).not.toBe(composer.editor);
  });
});
