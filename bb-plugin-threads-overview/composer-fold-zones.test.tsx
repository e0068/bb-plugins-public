// @vitest-environment jsdom
//
// Where a pull on bb's composer starts decides what it folds. From the body —
// the draft and what sits above the buttons — the composer shrinks with the
// finger while the keyboard stays, and let go past the reach the keyboard goes
// as the composer rides down to one line. From the panel — the row of buttons
// and the project row under the composer — only the keyboard goes, let go past
// the same reach, and the composer stays as it stands.
// And an open composer holds a push up to itself, so the page does not shake.
// The rules are pinned in src/core/composer-fold-zones.test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPOSER_FOLDED_HEIGHT } from "./src/core/composer-fold";

function stubFinger(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

/** One finger at a point on `on`; jsdom ships no TouchEvent, so the touch list is hung on a plain event. */
function finger(type: string, y: number, on: Element): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
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
  /** The row of buttons at the foot of the form. */
  readonly buttons: HTMLElement;
  /** The project and environment row under the form, in the composer's shell. */
  readonly projectRow: HTMLElement;
}

/** bb's composer as it stands on the page, `height` px tall: shell, form with draft and buttons, the row under it. */
function drawComposer(height: number): Composer {
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
  const buttons = document.createElement("div");
  buttons.setAttribute("data-promptbox-action-row", "");
  const send = document.createElement("button");
  buttons.append(send);
  form.append(draft, buttons);
  const projectRow = document.createElement("div");
  shell.append(form, projectRow);
  document.body.append(shell);
  return { form, draft, editor, buttons: send, projectRow };
}

async function renderOverlay() {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays.find((registration) => registration.id === "composer-fold")!;
  return renderSlot(overlay, {}, { context: { threadId: "th_a" } });
}

const typing = (composer: Composer) => document.activeElement === composer.editor;
const folded = (composer: Composer) => composer.form.hasAttribute("data-composer-folded");

beforeEach(() => {
  stubFinger();
  window.innerHeight = 800;
});
afterEach(cleanup);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a pull from the panel", () => {
  for (const [where, on] of [
    ["the row of buttons", (composer: Composer) => composer.buttons],
    ["the project row under the composer", (composer: Composer) => composer.projectRow],
  ] as const) {
    it(`from ${where} keeps the keyboard while the finger still pulls past the reach`, async () => {
      const composer = drawComposer(180);
      await renderOverlay();
      composer.editor.focus();
      finger("touchstart", 600, on(composer));
      finger("touchmove", 670, on(composer));

      expect(typing(composer)).toBe(true);
    });

    it(`from ${where} puts the keyboard away let go past the reach`, async () => {
      const composer = drawComposer(180);
      await renderOverlay();
      composer.editor.focus();
      finger("touchstart", 600, on(composer));
      finger("touchmove", 670, on(composer));
      finger("touchend", 670, on(composer));

      expect(typing(composer)).toBe(false);
    });

    it(`from ${where} leaves the composer as it stands`, async () => {
      const composer = drawComposer(180);
      await renderOverlay();
      composer.editor.focus();
      finger("touchstart", 600, on(composer));
      finger("touchmove", 670, on(composer));
      expect(composer.form.style.maxHeight).toBe("");
      finger("touchend", 670, on(composer));

      expect(folded(composer)).toBe(false);
      expect(composer.form.style.maxHeight).toBe("");
      expect(composer.form.style.height).toBe("");
    });
  }

  it("keeps the keyboard short of the reach", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    finger("touchstart", 600, composer.buttons);
    finger("touchmove", 630, composer.buttons);
    finger("touchend", 630, composer.buttons);

    expect(typing(composer)).toBe(true);
  });

  it("keeps the keyboard when the finger comes back short of the reach before letting go", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    finger("touchstart", 600, composer.buttons);
    finger("touchmove", 670, composer.buttons);
    finger("touchmove", 620, composer.buttons);
    finger("touchend", 620, composer.buttons);

    expect(typing(composer)).toBe(true);
  });

  it("holds the page still while the keyboard is out", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    finger("touchstart", 600, composer.buttons);

    expect(finger("touchmove", 603, composer.buttons).defaultPrevented).toBe(true);
  });

  it("holds nothing with no keyboard to put away", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    finger("touchstart", 600, composer.buttons);

    expect(finger("touchmove", 670, composer.buttons).defaultPrevented).toBe(false);
  });
});

describe("a pull from the body", () => {
  it("keeps the keyboard while the finger still pulls past the reach, shrinking the composer", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 670, composer.editor);

    expect(typing(composer)).toBe(true);
    expect(composer.form.style.maxHeight).toBe("110px");
  });

  it("let go past the reach, puts the keyboard away as the composer rides down to one line", async () => {
    vi.useFakeTimers();
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 670, composer.editor);
    finger("touchend", 670, composer.editor);

    expect(typing(composer)).toBe(false);
    expect(folded(composer)).toBe(true);
    expect(composer.form.style.transition).toContain("height");
  });

  it("brought back short of the reach and let go, keeps the keyboard and stands back up", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 670, composer.editor);
    finger("touchmove", 620, composer.editor);
    finger("touchend", 620, composer.editor);

    expect(typing(composer)).toBe(true);
    expect(folded(composer)).toBe(false);
  });

  it("keeps the keyboard short of the reach, shrinking the composer all the same", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    composer.editor.focus();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 630, composer.editor);

    expect(typing(composer)).toBe(true);
    expect(composer.form.style.maxHeight).toBe("150px");
  });

  it("let go past the reach, rides from where the finger left it down to one line", async () => {
    vi.useFakeTimers();
    const composer = drawComposer(180);
    await renderOverlay();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 670, composer.editor);
    finger("touchend", 670, composer.editor);

    expect(folded(composer)).toBe(true);
    expect(composer.form.style.height).toBe(`${COMPOSER_FOLDED_HEIGHT}px`);
    expect(composer.form.style.transition).toContain("height");
  });

  it("leaves no ridden height behind once the fold has settled", async () => {
    vi.useFakeTimers();
    const composer = drawComposer(180);
    await renderOverlay();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 670, composer.editor);
    finger("touchend", 670, composer.editor);
    vi.advanceTimersByTime(300);

    expect(folded(composer)).toBe(true);
    expect(composer.form.style.height).toBe("");
    expect(composer.form.style.maxHeight).toBe("");
  });
});

describe("a push up over the composer", () => {
  it("is held over an open composer, from the body and from the panel", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    for (const on of [composer.editor, composer.buttons, composer.projectRow]) {
      finger("touchstart", 600, on);
      expect(finger("touchmove", 599, on).defaultPrevented).toBe(true);
      finger("touchend", 599, on);
    }
  });

  it("is left alone over a composer bb has drawn compact", async () => {
    const composer = drawComposer(50);
    composer.form.setAttribute("data-promptbox-compact", "");
    await renderOverlay();
    finger("touchstart", 600, composer.editor);

    expect(finger("touchmove", 540, composer.editor).defaultPrevented).toBe(false);
  });

  it("is left alone over a folded composer", async () => {
    const composer = drawComposer(180);
    await renderOverlay();
    finger("touchstart", 600, composer.editor);
    finger("touchmove", 670, composer.editor);
    finger("touchend", 670, composer.editor);
    finger("touchstart", 600, composer.editor);

    expect(finger("touchmove", 540, composer.editor).defaultPrevented).toBe(false);
  });

  it("is left to a draft that still has lines below to scroll to", async () => {
    const composer = drawComposer(180);
    Object.defineProperties(composer.draft, {
      scrollTop: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
    });
    await renderOverlay();
    finger("touchstart", 600, composer.editor);

    expect(finger("touchmove", 540, composer.editor).defaultPrevented).toBe(false);
  });
});
