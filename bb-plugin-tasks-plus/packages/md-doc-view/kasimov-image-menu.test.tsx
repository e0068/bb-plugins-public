// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { KasimovImage, KasimovImageActions } from "../kasimov/kasimov.js";

// The subject here is the wrapper's wiring — what it hands the engine and what
// it takes away again — so the factory is stubbed to capture the options, the
// way KasimovEditor.test.tsx does. What the engine then DOES with the menu's
// actions is image-tail.test.ts, on the real engine and with nothing mocked.
// The alignment values stay the real ones — image-menu.ts hands them straight
// back to the engine, and a stub pair would let a wrong one through.
const created: Array<Record<string, unknown>> = [];
vi.mock("../kasimov/kasimov.js", async (importActual) => ({
  ...(await importActual<typeof import("../kasimov/kasimov.js")>()),
  createEditor: (_host: HTMLElement, opts: Record<string, unknown>) => {
    created.push(opts);
    return {
      getValue: () => "",
      setValue: () => {},
      focus: () => {},
      undo: () => false,
      destroy: () => {},
    };
  },
}));

// kit's menu hangs on document.body and gives back only a controller. The mock
// records what it was anchored to and what it was told to show.
const menus: Array<{ anchor: HTMLElement; spec: { items: unknown[] }; open: number; close: number }> = [];
vi.mock("../cellular-react", () => ({
  uiMenu: (anchor: HTMLElement, spec: { items: unknown[] }) => {
    const entry = { anchor, spec, open: 0, close: 0 };
    menus.push(entry);
    return {
      open: () => {
        entry.open += 1;
      },
      close: () => {
        entry.close += 1;
      },
      toggle: () => {},
      isOpen: () => entry.open > entry.close,
      contains: () => false,
    };
  },
}));

import { KasimovEditor } from "./KasimovEditor";

afterEach(() => {
  created.length = 0;
  menus.length = 0;
  cleanup();
});

const noop = () => {};
const actions = (over: Partial<KasimovImageActions> = {}): KasimovImageActions => ({
  setWidth: noop,
  setHeight: noop,
  setAlign: noop,
  setHideCaption: noop,
  remove: noop,
  ...over,
});

const image: KasimovImage = {
  alt: "the shot",
  src: "shot.png",
  max: { tag: "w", w: 600 },
  align: { tag: "center" },
  hideCaption: false,
};

const askForMenu = (anchor: HTMLElement, acts = actions()) => {
  const imageMenu = created[0].imageMenu as (
    a: HTMLElement,
    i: KasimovImage,
    x: KasimovImageActions,
  ) => void;
  imageMenu(anchor, image, acts);
};

describe("KasimovEditor — the picture's menu", () => {
  // Without this option the engine does not create the "⋯" button at all.
  it("the engine is handed something to draw the menu with", () => {
    render(<KasimovEditor value="x" />);
    expect(typeof created[0].imageMenu).toBe("function");
  });

  it("the menu opens on the button the engine asked from", () => {
    render(<KasimovEditor value="x" />);
    const anchor = document.createElement("span");
    askForMenu(anchor);
    expect(menus).toHaveLength(1);
    expect(menus[0].anchor).toBe(anchor);
    expect(menus[0].open).toBe(1);
    expect(menus[0].spec.items).toHaveLength(4);
  });

  // Every action rebuilds the whole document and destroys the anchor, so a
  // second ask gets its own menu rather than reopening a menu hung on a node
  // that is no longer in the document.
  it("a second ask closes the first menu and opens a new one", () => {
    render(<KasimovEditor value="x" />);
    askForMenu(document.createElement("span"));
    askForMenu(document.createElement("span"));
    expect(menus).toHaveLength(2);
    expect(menus[0].close).toBe(1);
    expect(menus[1].open).toBe(1);
  });

  // The menu lives on document.body, outside anything React takes away.
  it("unmounting the editor closes the menu", () => {
    const view = render(<KasimovEditor value="x" />);
    askForMenu(document.createElement("span"));
    view.unmount();
    expect(menus[0].close).toBe(1);
  });

  // The width the slider has not handed over yet is an edit aimed at an editor
  // that is about to stop existing: a drag, then a switch out of Write inside
  // the wait, and the edit would land on a document nobody is looking at.
  it("a width still on its way is dropped when the editor goes away", () => {
    vi.useFakeTimers();
    try {
      const widths: number[] = [];
      const view = render(<KasimovEditor value="x" />);
      askForMenu(document.createElement("span"), actions({ setWidth: (w) => widths.push(w) }));
      const slider = menus[0].spec.items[1] as { onInput: (w: number) => void };
      slider.onInput(600);
      view.unmount();
      vi.advanceTimersByTime(10_000);
      expect(widths).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a width handed over before the editor goes away still arrives", () => {
    vi.useFakeTimers();
    try {
      const widths: number[] = [];
      render(<KasimovEditor value="x" />);
      askForMenu(document.createElement("span"), actions({ setWidth: (w) => widths.push(w) }));
      const slider = menus[0].spec.items[1] as { onInput: (w: number) => void };
      slider.onInput(600);
      vi.advanceTimersByTime(10_000);
      expect(widths).toEqual([600]);
    } finally {
      vi.useRealTimers();
    }
  });
});
