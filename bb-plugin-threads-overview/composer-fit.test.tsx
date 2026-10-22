// @vitest-environment jsdom
//
// Keeping bb's composer on the screen: with the keyboard out a long draft no
// longer pushes the composer up under the thread's header — it stops 120 px
// under the top of the part of the screen the keyboard leaves. The rule is pinned in
// src/core/composer-fold.test; here is what the overlay does with a real
// composer on the page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { fitComposer } from "./composer-fit";

const ROOM = "--composer-editor-available-height";

interface Composer {
  readonly form: HTMLFormElement;
  readonly draft: HTMLElement;
}

/** bb's composer, its form from `top` and its draft from 10 px below that down to 700. */
function drawComposer(top: number, under: Element = document.body): Composer {
  const shell = document.createElement("div");
  shell.setAttribute("data-app-composer", "");
  shell.setAttribute("data-app-composer-role", "primary");
  const form = document.createElement("form");
  form.setAttribute("data-promptbox", "");
  form.getBoundingClientRect = () => ({ top, bottom: 760, height: 760 - top }) as DOMRect;
  const draft = document.createElement("div");
  draft.setAttribute("data-promptbox-editor-scroll", "");
  draft.getBoundingClientRect = () => ({ top: top + 10, bottom: 700 }) as DOMRect;
  form.append(draft);
  shell.append(form);
  under.append(shell);
  return { form, draft };
}

/** The part of the screen the keyboard leaves, from `offsetTop` down; it says when it moves. */
function stubView(offsetTop: number) {
  const listeners = new Set<() => void>();
  const view = {
    offsetTop,
    height: 800,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    move(to: number) {
      view.offsetTop = to;
      listeners.forEach((listener) => listener());
    },
  };
  vi.stubGlobal("visualViewport", view);
  return view;
}

const room = (composer: Composer) => composer.draft.style.getPropertyValue(ROOM);

const nextFrame = () => new Promise((done) => window.requestAnimationFrame(() => done(undefined)));

/** A ResizeObserver whose callbacks fire when told: jsdom ships none. */
function stubResizes(): () => void {
  const callbacks = new Set<() => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        callbacks.add(this.callback);
      }
      disconnect() {
        callbacks.delete(this.callback);
      }
    },
  );
  return () => callbacks.forEach((callback) => callback());
}

beforeEach(() => {
  window.innerHeight = 800;
});
afterEach(cleanup);
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a composer kept on the screen", () => {
  it("stays under the thread's header: the draft grows no higher than 120 px under the top of the screen", () => {
    const composer = drawComposer(50);
    fitComposer(composer.form);
    expect(room(composer)).toBe(`${700 - 120 - 10}px`);
  });

  it("stays inside the part of the screen the keyboard leaves", () => {
    stubView(200);
    const composer = drawComposer(50);
    fitComposer(composer.form);
    expect(room(composer)).toBe(`${700 - 200 - 120 - 10}px`);
  });

  it("is fitted again, a frame later, when the part of the screen the keyboard leaves moves", async () => {
    const view = stubView(0);
    const composer = drawComposer(50);
    fitComposer(composer.form);
    view.move(150);
    await nextFrame();
    expect(room(composer)).toBe(`${700 - 150 - 120 - 10}px`);
  });

  it("is fitted again once bb has laid its screen out for the keyboard", async () => {
    const composer = drawComposer(50);
    fitComposer(composer.form);
    composer.draft.getBoundingClientRect = () => ({ top: 60, bottom: 400 }) as DOMRect;
    composer.form.getBoundingClientRect = () => ({ top: 50, bottom: 460, height: 410 }) as DOMRect;
    document.body.style.setProperty("--bb-shell-height", "460px");
    await nextFrame();
    expect(room(composer)).toBe(`${400 - 120 - 10}px`);
  });

  it("is left as it was while its foot is out of what is seen, a screen bb has not laid out yet", () => {
    stubView(300);
    const composer = drawComposer(50);
    composer.form.getBoundingClientRect = () => ({ top: 50, bottom: 300, height: 250 }) as DOMRect;
    fitComposer(composer.form);
    expect(room(composer)).toBe("");
  });

  it("keeps the same room as the composer changes size with its foot where it is", () => {
    const resized = stubResizes();
    const composer = drawComposer(50);
    fitComposer(composer.form);
    const before = room(composer);
    composer.form.getBoundingClientRect = () => ({ top: 300, bottom: 760, height: 460 }) as DOMRect;
    composer.draft.getBoundingClientRect = () => ({ top: 310, bottom: 700 }) as DOMRect;
    resized();
    expect(room(composer)).toBe(before);
  });

  it("keeps its room while a finger pulls the composer down to fold it, and once it is folded", () => {
    const resized = stubResizes();
    const composer = drawComposer(50);
    fitComposer(composer.form);
    const before = room(composer);
    composer.draft.getBoundingClientRect = () => ({ top: 210, bottom: 860 }) as DOMRect;
    composer.form.style.maxHeight = "400px";
    resized();
    expect(room(composer)).toBe(before);
    composer.form.style.maxHeight = "";
    composer.form.setAttribute("data-composer-folded", "");
    resized();
    expect(room(composer)).toBe(before);
  });

  it("is left to bb once let go", () => {
    const composer = drawComposer(50);
    fitComposer(composer.form)();
    expect(room(composer)).toBe("");
  });

  it("is kept on the screen by the overlay under a finger", async () => {
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
    const composer = drawComposer(50);
    const app = await loadPluginApp(() => import("./app"));
    const overlay = app.appOverlays.find((registration) => registration.id === "composer-fold")!;
    renderSlot(overlay, {}, { context: { threadId: "th_a" } });
    expect(room(composer)).toBe(`${700 - 120 - 10}px`);
  });
});
